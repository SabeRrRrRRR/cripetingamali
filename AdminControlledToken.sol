// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract AdminControlledToken is ERC20, AccessControl, Pausable {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    mapping(address => bool) private _blacklisted;

    event Blacklisted(address indexed who);
    event UnBlacklisted(address indexed who);

    constructor(string memory name_, string memory symbol_, uint256 initialSupply) ERC20(name_, symbol_) {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(PAUSER_ROLE, msg.sender);
        _setupRole(BLACKLISTER_ROLE, msg.sender);
        _setupRole(MINTER_ROLE, msg.sender);

        _mint(msg.sender, initialSupply);
    }

    function blacklist(address who) external onlyRole(BLACKLISTER_ROLE) {
        _blacklisted[who] = true;
        emit Blacklisted(who);
    }

    function unblacklist(address who) external onlyRole(BLACKLISTER_ROLE) {
        _blacklisted[who] = false;
        emit UnBlacklisted(who);
    }

    function isBlacklisted(address who) public view returns (bool) {
        return _blacklisted[who];
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    // Override transfer functions to respect pause and blacklist
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override whenNotPaused {
        require(!_blacklisted[from], "AdminControlledToken: sender blacklisted");
        require(!_blacklisted[to], "AdminControlledToken: recipient blacklisted");
        super._beforeTokenTransfer(from, to, amount);
    }
}
