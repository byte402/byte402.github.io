// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Allot Split
/// @notice One address that receives tokens (USDG from x402 payments) and shares them between fixed payees
/// by fixed shares. Use it as an API's payTo. There is no owner, no admin, no upgrade path and no way to change
/// the payees or shares after creation. Nobody can take more than their share.
/// @dev Pull accounting: a payee's due amount is (everything ever received x share / total shares) minus what
/// it already got. Anyone may release a payee's due amount to that payee, so a payee that cannot receive never
/// blocks the others. Rounding dust stays in the contract and is paid out as more arrives.
interface IERC20 {
    function balanceOf(address who) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
}

contract AllotSplit {
    uint256 public constant MAX_PAYEES = 10;

    address[] private _payees;
    mapping(address => uint256) public shares;
    uint256 public immutable totalShares;

    mapping(address => uint256) public totalReleased; // token => amount
    mapping(address => mapping(address => uint256)) public released; // token => payee => amount

    event Released(address indexed token, address indexed payee, uint256 amount);

    error Bad(string why);

    constructor(address[] memory payees_, uint256[] memory shares_) {
        uint256 n = payees_.length;
        if (n < 2 || n > MAX_PAYEES) revert Bad("2 to 10 payees");
        if (n != shares_.length) revert Bad("one share per payee");
        uint256 total;
        for (uint256 i; i < n; ++i) {
            address p = payees_[i];
            if (p == address(0)) revert Bad("payee is the zero address");
            if (shares_[i] == 0) revert Bad("share is zero");
            if (shares[p] != 0) revert Bad("payee listed twice");
            shares[p] = shares_[i];
            _payees.push(p);
            total += shares_[i];
        }
        totalShares = total;
    }

    function payees() external view returns (address[] memory) {
        return _payees;
    }

    /// @notice What `payee` can be paid in `token` right now.
    function releasable(address token, address payee) public view returns (uint256) {
        uint256 received = IERC20(token).balanceOf(address(this)) + totalReleased[token];
        return (received * shares[payee]) / totalShares - released[token][payee];
    }

    /// @notice Pay `payee` its due amount of `token`. Anyone can call it; the tokens only ever go to the payee.
    function release(address token, address payee) public returns (uint256 amount) {
        if (shares[payee] == 0) revert Bad("not a payee");
        amount = releasable(token, payee);
        if (amount == 0) return 0;
        released[token][payee] += amount;
        totalReleased[token] += amount;
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (payee, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert Bad("token transfer failed");
        emit Released(token, payee, amount);
    }

    /// @notice Pay every payee its due amount of `token`. A payee whose transfer fails is skipped, not the rest.
    function releaseAll(address token) external {
        uint256 n = _payees.length;
        for (uint256 i; i < n; ++i) {
            try this.release(token, _payees[i]) {} catch {}
        }
    }
}

/// @title Allot Split Factory
/// @notice Anyone can create a Split. The factory keeps no control over the Splits it creates.
contract AllotSplitFactory {
    event SplitCreated(address indexed creator, address split, address[] payees, uint256[] shares);

    address[] private _all;
    mapping(address => address[]) private _byCreator;

    function create(address[] calldata payees, uint256[] calldata shares) external returns (address split) {
        split = address(new AllotSplit(payees, shares));
        _all.push(split);
        _byCreator[msg.sender].push(split);
        emit SplitCreated(msg.sender, split, payees, shares);
    }

    function splitsOf(address creator) external view returns (address[] memory) {
        return _byCreator[creator];
    }

    function count() external view returns (uint256) {
        return _all.length;
    }
}
