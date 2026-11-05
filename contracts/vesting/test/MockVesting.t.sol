// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockVesting, MockToken} from "../src/MockVesting.sol";

contract MockVestingTest is Test {
    address lot = address(0x10);
    address buyer = address(0xB0b);
    MockVesting v;
    MockToken t;

    function setUp() public {
        v = new MockVesting(lot, 100, 1000e18);
        t = v.token();
    }

    function test_onlyBeneficiaryCanClaim() public {
        vm.warp(block.timestamp + 50);
        vm.expectRevert(MockVesting.NotBeneficiary.selector);
        vm.prank(buyer);
        v.claim(buyer);
    }

    function test_claimPaysVestedToRecipient() public {
        vm.warp(block.timestamp + 50);
        vm.prank(lot);
        v.claim(buyer);
        assertEq(t.balanceOf(buyer), 500e18);
    }

    function test_claimWithNothingVestedSucceeds() public {
        vm.prank(lot);
        assertEq(v.claim(buyer), 0);
        vm.prank(lot);
        assertEq(v.claim(buyer), 0);
    }

    function test_speedUpIsOneWay() public {
        v.speedUp(uint64(block.timestamp + 10));
        vm.expectRevert(MockVesting.NotEarlier.selector);
        v.speedUp(uint64(block.timestamp + 20));
        vm.warp(block.timestamp + 10);
        assertEq(v.claimable(), 1000e18);
    }
}
