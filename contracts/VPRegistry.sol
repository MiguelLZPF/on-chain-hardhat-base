// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "./interfaces/IVPRegistry.sol";
import "./external/BaseRelayRecipient.sol";

contract VPRegistry is Initializable, IVPRegistry, BaseRelayRecipient {
  // VARIABLES
  // The important relationships between id, hashes and statuses
  // hash(VC) --> Status
  mapping(bytes32 => VPStatus) statuses;
  // Relation to know wich presenter presented what VP
  // hash(VC) --> Verifier
  mapping(bytes32 => address) presenters;

  // FUNCTIONS
  // == External ==

  /** "Constructor"
    @notice Upgradeable constructor
  */
  function initialize() external initializer {}

  /** Register
    @notice Register a new Verifiable Presentation (VP) Hash
    @param vpHash keccak256 | SHA3 VP hash
    @param exp (Required) expiration date as epoch time (seconds).
    @param nbf (Optional = 0) not before date as epoch time (seconds). If not used set to 0.
  */
  function register(
    bytes32 vpHash,
    address[10] memory allowedVerifiers,
    uint256 exp,
    uint256 nbf
  ) external {
    require(exp > block.timestamp + 10, "Expiration has to be greater than  now + 10 seconds");
    // to avoid that other users can register the same presentation hash
    require(
      presenters[vpHash] == address(0) || presenters[vpHash] == _msgSender(),
      "Cannot registrate hashes from multiple senders"
    );
    VPStatus storage status = statuses[vpHash];
    // check state < PRESENTED or CANCELED
    require(status.state < 2 || status.state == 10, "Cannot be already PRESENTED");
    // register status
    status.state = 1;
    status.allowedVerifiers = allowedVerifiers;
    status.finalVerifier = address(0);
    status.valid = true;
    status.rat = block.timestamp;
    status.uat = block.timestamp;
    status.exp = exp;
    status.nbf = nbf;

    statuses[vpHash] = status;
    // register presenter
    presenters[vpHash] = _msgSender();
    emit Registered(vpHash, _msgSender(), allowedVerifiers);
    emit StatusChanged(vpHash, 0, 1, "Registered");
  }

  /** Presented
    @notice Mark a Verifiable Presentation (VP) Hash as presented by the verifier
    @param vpHash keccak256 | SHA3 VP hash
  */
  function presented(bytes32 vpHash) external {
    // get status from storage with updated dates
    VPStatus storage status = _updateDates(vpHash);
    // check if hash is valid (dates)
    require(status.valid, "This VP is not valid at this time");
    // check state == REGISTERED
    require(status.state == 1, "Must be in REGISTERED state");
    // check if sender is in allowedVerifiers array
    // -- if first is 0x00...00 then anyone can verify this presentation
    if (status.allowedVerifiers[0] != address(0)) {
      bool allowed = false;
      for (uint256 i = 0; i < status.allowedVerifiers.length; i++) {
        if (status.allowedVerifiers[i] == _msgSender()) {
          allowed = true;
          break;
          // if is the 0 address, it does not look any further
        } else if (status.allowedVerifiers[i] == address(0)) {
          break;
        }
      }
      require(allowed, "Must be an allowed verifier to receive this VP");
    }
    // change state to PRESENTED and update fields
    status.state = 2;
    status.finalVerifier = _msgSender();
    status.uat = block.timestamp;
    // generate events
    emit Presented(vpHash, _msgSender());
    emit StatusChanged(vpHash, 1, 2, "Presented");
  }

  /** Consumed
    @notice Mark a Verifiable Presentation (VP) Hash as consumed by the verifier
    @notice This action
    @param vpHash keccak256 | SHA3 VP hash
  */
  function consumed(bytes32 vpHash) external {
    // get status from storage with updated dates
    VPStatus storage status = statuses[vpHash];
    // check state == PRESENTED
    require(status.state == 2, "Must be in PRESENTED state");
    // check final verifier is the _msgSender()
    require(_msgSender() == status.finalVerifier, "Only the same verifier can mark as consumed");
    // change state to CONSUMED and update fields
    status.state = 3;
    //status.finalVerifier = _msgSender();
    status.uat = block.timestamp;
    // generate events
    emit Consumed(vpHash, _msgSender());
    emit StatusChanged(vpHash, 2, 3, "Consumed");
    emit NoStoragePolicy(
      vpHash,
      status.finalVerifier,
      "I have NOT stored any data relat",
      "ed with this VP"
    );
  }

  /** Cancel
    @notice Mark a Verifiable Presentation (VP) Hash as canceled by the presenter
    @param vpHash keccak256 | SHA3 VP hash
  */
  function cancel(bytes32 vpHash) external {
    // get status from storage with updated dates
    VPStatus storage status = statuses[vpHash];
    // check state == REGISTERED
    require(status.state == 1, "Must be in REGISTERED state");
    // check sender is the presenter
    require(
      _msgSender() == presenters[vpHash],
      "Only the presenter who registered the VP can cancel it"
    );
    emit StatusChanged(vpHash, status.state, 10, "Canceled");
    // change state to CANCELED and update fields
    status.state = 10;
    status.uat = block.timestamp;
    // generate event
    emit Consumed(vpHash, _msgSender());
  }

  // == External View ==

  /** Get VP Status
    @notice Gets the hole status of a given VC hash
    @param vpHash keccak256 | SHA3 VC hash
    @param extTimestamp (optional) external timestamp to compare with,
    if not set it compares with the latest block timestamp
    @return found boolean to know if something is found
    @return status Actual status updated to block.timestamp time
  */
  function getStatus(bytes32 vpHash, uint256 extTimestamp)
    external
    view
    returns (bool found, VPStatus memory status)
  {
    if (extTimestamp == 0) {
      // check dates with timestamp of the latest generated block
      status = _checkDates(vpHash, block.timestamp);
    } else {
      // check dates with extenal timestamp
      status = _checkDates(vpHash, extTimestamp);
    }

    if (status.state == 0) {
      return (false, status);
    } else {
      return (true, status);
    }
  }

  // == Public ==

  // == Internal ==

  /** Update Dates
    @notice Updates the status of a VC hash if the dates asociated to it are not valid
    @notice This function does change the state
    @param vpHash keccak256 | SHA3 VC hash
    @return status Actual status updated to block.timestamp time
  */
  function _updateDates(bytes32 vpHash) internal returns (VPStatus storage status) {
    status = statuses[vpHash];
    if (status.state != 0) {
      //  valid == true and            now < not before or             now >= expitation
      if (status.valid && (block.timestamp < status.nbf || block.timestamp >= status.exp)) {
        // This changes the status in storage
        status.valid = false;
        //      valid == false and           now > not before
      } else if (!status.valid && (block.timestamp >= status.nbf && block.timestamp < status.exp)) {
        // This changes the status in storage
        status.valid = true;
      }
    }
    return status;
  }

  /** Check Dates
    @notice ONLY checks if the dates asociated to a VC are still valid
    @notice This function does NOT change the state, it only creates an updated copy in memory
    @param vpHash keccak256 | SHA3 VC hash
    @param timestamp date to compare with
    @return status Actual copy of the status updated to block.timestamp time
  */
  function _checkDates(bytes32 vpHash, uint256 timestamp)
    internal
    view
    returns (VPStatus memory status)
  {
    status = statuses[vpHash];
    if (status.state != 0) {
      //  valid == true and      now < not before or       now >= expitation
      if (status.valid && (timestamp < status.nbf || timestamp >= status.exp)) {
        // This does NOT change the status in storage
        status.valid = false;
        //      valid == false and       now >= not before          now < expitation
      } else if (!status.valid && (timestamp >= status.nbf && timestamp < status.exp)) {
        // This does NOT change the status in storage
        status.valid = true;
      }
    }
    return status;
  }
}
