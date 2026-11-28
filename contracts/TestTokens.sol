// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
// Test only. A minimal 6-decimal token like USDG, with an optional blocked address to test a payee that cannot receive.
contract TestUSDG {
    string public constant name = "Test USDG"; string public constant symbol = "tUSDG"; uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf; uint256 public totalSupply; address public blocked;
    event Transfer(address indexed from, address indexed to, uint256 value);
    function mint(address to, uint256 v) external { balanceOf[to] += v; totalSupply += v; emit Transfer(address(0), to, v); }
    function setBlocked(address b) external { blocked = b; }
    function transfer(address to, uint256 v) external returns (bool) { require(to != blocked, "blocked"); require(balanceOf[msg.sender] >= v, "balance"); balanceOf[msg.sender] -= v; balanceOf[to] += v; emit Transfer(msg.sender, to, v); return true; }
}
