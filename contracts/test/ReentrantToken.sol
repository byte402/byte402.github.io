// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
// Test only. A malicious token: every transfer calls back into the Split before returning, trying to be paid twice.
interface ISplit { function release(address token, address payee) external returns (uint256); function releaseAll(address token) external; }
contract ReentrantToken {
    mapping(address => uint256) public balanceOf;
    address public split; address public payee; uint256 public attacks; bool public useAll;
    function mint(address to, uint256 v) external { balanceOf[to] += v; }
    function arm(address s, address p, bool all) external { split = s; payee = p; useAll = all; }
    function transfer(address to, uint256 v) external returns (bool) {
        require(balanceOf[msg.sender] >= v, "balance");
        balanceOf[msg.sender] -= v; balanceOf[to] += v;
        if (msg.sender == split && attacks < 3) { attacks++;
            if (useAll) { try ISplit(split).releaseAll(address(this)) {} catch {} }
            else { try ISplit(split).release(address(this), payee) {} catch {} } }
        return true;
    }
}
