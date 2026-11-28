// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
// Test only. Two non-standard tokens to pin down how Split behaves with them (see SPLIT.md, "Known behaviour").
// FeeToken: every transfer burns 1% of the amount. RebaseToken: anyone can shrink a holder's balance (a negative rebase).
contract FeeToken {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 v) external { balanceOf[to] += v; }
    function transfer(address to, uint256 v) external returns (bool) { require(balanceOf[msg.sender] >= v, "balance"); balanceOf[msg.sender] -= v; balanceOf[to] += v - v / 100; return true; }
}
contract RebaseToken {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 v) external { balanceOf[to] += v; }
    function shrink(address who, uint256 v) external { balanceOf[who] -= v; }
    function transfer(address to, uint256 v) external returns (bool) { require(balanceOf[msg.sender] >= v, "balance"); balanceOf[msg.sender] -= v; balanceOf[to] += v; return true; }
}
