// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Allot Vault v3
/// @notice An allowance for AI agents. The owner funds the vault with one token (USDG) and gives each agent
/// a session key with rules: a cap per payment, a budget per UTC day, an expiry and a list of payees.
/// v2 added an optional budget per UTC day for each payee (per provider), on top of the agent's own budget.
/// v3 fixes three edge cases found in an outside review of v2: release() only gives back payee budget that was
/// actually charged, an x402 authorization stops being valid as soon as its agent is revoked, expires or loses
/// that payee, and the same transfer cannot be authorized twice. It also records each authorization's nonce,
/// caps how long an authorization can stay valid, and makes a freeze cancel every authorization made before it.
/// The contract itself enforces every rule, so a leaked or hijacked agent key can never spend more.
/// Two ways to pay:
///   1. pay(): the agent sends a transaction and the vault transfers directly.
///   2. authorize(): the agent pre-approves one x402 / EIP-3009 transfer; the token then accepts the vault
///      as signer through ERC-1271 (isValidSignature), so standard x402 facilitators can settle it.
/// There is no admin besides the owner, no upgrade path, and no function that lets anyone but the owner
/// move funds outside an agent's rules.
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface IERC3009 {
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}

contract AllotVault {
    uint8 public constant VERSION = 3;
    uint256 public constant MAX_VALIDITY = 1 hours; // longest an x402 authorization may stay valid
    uint32 public freezeEpoch;                        // goes up on every freeze: older authorizations stop working

    struct Agent {
        uint128 perPayment;  // max for a single payment
        uint128 perDay;      // max per UTC day, across all payments
        uint128 spentToday;  // spent in the current day
        uint32 day;          // UTC day number of spentToday
        uint64 expiry;       // unix time after which the key stops working (0 = never)
        bool active;
    }

    // EIP-3009 typehash, as used by USDG
    bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)");
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;

    address public immutable owner;
    IERC20 public immutable token;
    bytes32 public immutable tokenDomainSeparator;
    bool public frozen;

    mapping(address => Agent) public agents;
    mapping(address => mapping(address => bool)) public payeeAllowed; // agent => payee => allowed
    mapping(bytes32 => bool) public approvedDigest;                   // x402 transfers pre-approved by an agent

    struct Pending {
        address agent;
        uint128 amount;
        uint32 day;
        bool payeeCharged;   // whether the payee's own daily budget was charged for it
        address to;
        bytes32 nonce;
        uint32 epoch;        // freezeEpoch when it was authorized
    }
    mapping(bytes32 => Pending) public pending;                       // who reserved the budget for each digest

    struct PayeeBudget {
        uint128 perDay;      // max per UTC day to this payee (0 = no extra limit beyond the agent's own)
        uint128 spentToday;  // spent to this payee in the current day
        uint32 day;          // UTC day number of spentToday
    }
    mapping(address => mapping(address => PayeeBudget)) public payeeBudget; // agent => payee => budget

    event AgentSet(address indexed agent, uint128 perPayment, uint128 perDay, uint64 expiry, bool active);
    event PayeeSet(address indexed agent, address indexed payee, bool allowed);
    event Paid(address indexed agent, address indexed to, uint256 amount, bytes32 ref);
    event Authorized(address indexed agent, address indexed to, uint256 amount, bytes32 digest, bytes32 ref);
    event Released(address indexed agent, bytes32 digest, uint256 amount);
    event Frozen(bool frozen);
    event Withdrawn(address indexed to, uint256 amount);
    event PayeeLimitSet(address indexed agent, address indexed payee, uint128 perDay);
    event AuthorizationNonce(bytes32 indexed digest, uint256 validAfter, uint256 validBefore, bytes32 nonce);

    error NotOwner();
    error NotAllowed(string reason);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, IERC20 token_, bytes32 tokenDomainSeparator_) {
        owner = owner_;
        token = token_;
        tokenDomainSeparator = tokenDomainSeparator_;
    }

    // ---------------- owner ----------------

    function setAgent(address agent, uint128 perPayment, uint128 perDay, uint64 expiry, bool active) external onlyOwner {
        Agent storage a = agents[agent];
        a.perPayment = perPayment;
        a.perDay = perDay;
        a.expiry = expiry;
        a.active = active;
        emit AgentSet(agent, perPayment, perDay, expiry, active);
    }

    function setPayee(address agent, address payee, bool allowed) external onlyOwner {
        payeeAllowed[agent][payee] = allowed;
        emit PayeeSet(agent, payee, allowed);
    }

    /// @notice Approve or remove a payee for an agent and set its own daily budget in one call.
    /// perDay = 0 means no extra limit: only the agent's cap per payment and daily budget apply.
    function setPayeeRule(address agent, address payee, bool allowed, uint128 perDay) external onlyOwner {
        payeeAllowed[agent][payee] = allowed;
        payeeBudget[agent][payee].perDay = perDay;
        emit PayeeSet(agent, payee, allowed);
        emit PayeeLimitSet(agent, payee, perDay);
    }

    function revoke(address agent) external onlyOwner {
        agents[agent].active = false;
        emit AgentSet(agent, agents[agent].perPayment, agents[agent].perDay, agents[agent].expiry, false);
    }

    function setFrozen(bool frozen_) external onlyOwner {
        if (frozen_ && !frozen) freezeEpoch++;
        frozen = frozen_;
        emit Frozen(frozen_);
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        _send(to, amount);
        emit Withdrawn(to, amount);
    }

    // ---------------- agent ----------------

    /// @notice Pay directly. Every rule is checked and the day budget is updated before the transfer.
    function pay(address to, uint256 amount, bytes32 ref) external {
        _spend(msg.sender, to, amount);
        _send(to, amount);
        emit Paid(msg.sender, to, amount, ref);
    }

    /// @notice Pre-approve one EIP-3009 transfer from this vault, for x402. The budget is reserved now;
    /// the token later asks isValidSignature() and gets a yes only for this exact transfer.
    function authorize(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes32 ref)
        external
        returns (bytes32 digest)
    {
        digest = transferDigest(to, value, validAfter, validBefore, nonce);
        if (approvedDigest[digest]) revert NotAllowed("already authorized");
        if (validBefore > block.timestamp + MAX_VALIDITY) revert NotAllowed("valid for too long");
        bool charged = _spend(msg.sender, to, value);
        approvedDigest[digest] = true;
        pending[digest] = Pending(msg.sender, uint128(value), _today(), charged, to, nonce, freezeEpoch);
        emit Authorized(msg.sender, to, value, digest, ref);
        emit AuthorizationNonce(digest, validAfter, validBefore, nonce);
    }

    /// @notice Cancel an x402 authorization that was never settled. The digest stops being valid at once,
    /// and if it is still the same UTC day the reserved amount goes back to the agent's budget.
    /// Callable by the agent that authorized it or by the owner.
    function release(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce) external {
        _release(transferDigest(to, value, validAfter, validBefore, nonce));
    }

    /// @notice Same as release(), by digest only: the vault kept the nonce, so the owner does not need it.
    function releaseDigest(bytes32 digest) external {
        _release(digest);
    }

    function _release(bytes32 digest) private {
        Pending memory p = pending[digest];
        if (!approvedDigest[digest]) revert NotAllowed("nothing to release");
        if (msg.sender != p.agent && msg.sender != owner) revert NotAllowed("not yours to release");
        if (IERC3009(address(token)).authorizationState(address(this), p.nonce)) revert NotAllowed("already settled");
        approvedDigest[digest] = false;
        delete pending[digest];
        Agent storage a = agents[p.agent];
        if (a.day == p.day && p.day == _today()) a.spentToday = a.spentToday > p.amount ? a.spentToday - p.amount : 0;
        if (p.payeeCharged) { // only give back payee budget that this authorization actually used
            PayeeBudget storage b = payeeBudget[p.agent][p.to];
            if (b.day == p.day && p.day == _today()) b.spentToday = b.spentToday > p.amount ? b.spentToday - p.amount : 0;
        }
        emit Released(p.agent, digest, p.amount);
    }

    // ---------------- views ----------------

    function transferDigest(address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, address(this), to, value, validAfter, validBefore, nonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", tokenDomainSeparator, structHash));
    }

    /// @notice ERC-1271. Only transfers an agent pre-approved through authorize() are valid, and only while the
    /// vault is not frozen, that agent is still active and unexpired, and the payee is still on its list.
    function isValidSignature(bytes32 hash, bytes calldata) external view returns (bytes4) {
        if (frozen || !approvedDigest[hash]) return 0xffffffff;
        Pending storage p = pending[hash];
        Agent storage a = agents[p.agent];
        // revoking the agent, its key expiring or removing the payee cancels its unsettled authorizations at once
        if (!a.active || (a.expiry != 0 && block.timestamp > a.expiry) || !payeeAllowed[p.agent][p.to]) return 0xffffffff;
        if (p.epoch != freezeEpoch) return 0xffffffff; // made before the last freeze: unfreezing does not revive it
        return ERC1271_MAGIC;
    }

    /// @notice What an agent can still spend today.
    function remainingToday(address agent) external view returns (uint256) {
        Agent storage a = agents[agent];
        if (!a.active || frozen || (a.expiry != 0 && block.timestamp > a.expiry)) return 0;
        uint256 spent = a.day == _today() ? a.spentToday : 0;
        return a.perDay > spent ? a.perDay - spent : 0;
    }

    /// @notice What an agent can still spend today to one payee: the smaller of its own and the payee's budget.
    function remainingTodayFor(address agent, address payee) external view returns (uint256) {
        if (!payeeAllowed[agent][payee]) return 0;
        Agent storage a = agents[agent];
        if (!a.active || frozen || (a.expiry != 0 && block.timestamp > a.expiry)) return 0;
        uint32 d = _today();
        uint256 spent = a.day == d ? a.spentToday : 0;
        uint256 left = a.perDay > spent ? a.perDay - spent : 0;
        PayeeBudget storage b = payeeBudget[agent][payee];
        if (b.perDay != 0) {
            uint256 ps = b.day == d ? b.spentToday : 0;
            uint256 pl = b.perDay > ps ? b.perDay - ps : 0;
            if (pl < left) left = pl;
        }
        return left;
    }

    // ---------------- internals ----------------

    function _spend(address agent, address to, uint256 amount) private returns (bool payeeCharged) {
        if (frozen) revert NotAllowed("vault frozen");
        Agent storage a = agents[agent];
        if (!a.active) revert NotAllowed("agent not active");
        if (a.expiry != 0 && block.timestamp > a.expiry) revert NotAllowed("agent key expired");
        if (!payeeAllowed[agent][to]) revert NotAllowed("payee not on the list");
        if (amount == 0 || amount > a.perPayment) revert NotAllowed("over the per payment cap");
        uint32 d = _today();
        if (a.day != d) {
            a.day = d;
            a.spentToday = 0;
        }
        uint256 next = uint256(a.spentToday) + amount;
        if (next > a.perDay) revert NotAllowed("over today's x402 limit");
        a.spentToday = uint128(next);
        PayeeBudget storage b = payeeBudget[agent][to];
        if (b.perDay != 0) {
            if (b.day != d) {
                b.day = d;
                b.spentToday = 0;
            }
            uint256 pnext = uint256(b.spentToday) + amount;
            if (pnext > b.perDay) revert NotAllowed("over today's limit for this payee");
            b.spentToday = uint128(pnext);
            payeeCharged = true;
        }
    }

    function _send(address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert NotAllowed("token transfer failed");
    }

    function _today() private view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }
}


/// @title Allot Factory v3
/// @notice Anyone can create their own Allot Vault. The caller becomes its only owner. The factory keeps no
/// control over vaults it creates: it only deploys them and lists them.
contract AllotFactory {
    IERC20 public immutable token;
    bytes32 public immutable tokenDomainSeparator;
    mapping(address => address[]) private _vaults;

    event VaultCreated(address indexed owner, address vault, uint256 index);

    constructor(IERC20 token_, bytes32 tokenDomainSeparator_) {
        token = token_;
        tokenDomainSeparator = tokenDomainSeparator_;
    }

    function create() external returns (address vault) {
        uint256 i = _vaults[msg.sender].length;
        vault = address(new AllotVault{salt: keccak256(abi.encode(msg.sender, i))}(msg.sender, token, tokenDomainSeparator));
        _vaults[msg.sender].push(vault);
        emit VaultCreated(msg.sender, vault, i);
    }

    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaults[owner];
    }
}
