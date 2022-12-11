// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { States, VCStatus, IVCRegistry } from "./interfaces/IVCRegistry.sol";
import "./external/BaseRelayRecipient.sol";

contract VCRegistry is Initializable, IVCRegistry, BaseRelayRecipient {
  // VARIABLES
  // Constant to send states as Strings
  mapping(States => string) private STATES_STR;
  // Bytes 0x00 hash to compare
  bytes32 private BYTES_00_HASH;
  // Known CXC system's Issuer/Issuers
  mapping(address => bool) private issuersCXC;
  // The important relationships between id, hashes and statuses
  // hash(VC) --> Status
  mapping(bytes32 => VCStatus) private statuses;
  // hash(ID) --> hash(VC)
  mapping(bytes32 => bytes32) private idToHash;
  // Relation to know wich issuer issued what VC
  // hash(VC) --> Issuer
  mapping(bytes32 => address) private vcIssuers;

  // FUNCTIONS
  // == External ==

  /** "Constructor"
    @notice Upgradeable constructor. Here it's initialized the issuer list as well as constants
    @param _issuers list of valid CXC issuers
  */
  function initialize(address[] memory _issuers) external initializer {
    // Constant
    BYTES_00_HASH = keccak256(new bytes(0x00));
    // Constants Upgradeable way
    STATES_STR[States.UNREGISTERED] = "UNREGISTERED";
    STATES_STR[States.VALID] = "VALID";
    STATES_STR[States.REVOKED] = "REVOKED";
    STATES_STR[States.EXPIRED] = "EXPIRED";
    // Set trusted issuers ==> alternative is to use Decentralized Trust contract
    for (uint256 i = 0; i < _issuers.length; i++) {
      issuersCXC[_issuers[i]] = true;
    }
  }

  // function _msgSender() internal view returns(address){
  //   return msg.sender;
  // }

  /** Add new issuer to CXC issuer list
  @notice only one registered issuer can add new ones
  @param _newIssuer the address of the new issuer
   */
  function addIssuer(address _newIssuer) external {
    require(issuersCXC[_msgSender()], "Only CXC issuers are allowed");
    issuersCXC[_newIssuer] = true;
  }

  /** Register
    @notice this function calls registerImp internally with ID
    @param _vcId id of the VC as Bytes of the UTF-8 encoded string
  */
  function register(
    bytes memory _vcId,
    bytes32 _vcHash,
    uint256 _exp,
    uint256 _nbf
  ) external {
    require(_vcId.length > 5, "ID length should be greater than 5 bytes");
    registerImp(keccak256(_vcId), _vcHash, _exp, _nbf);
  }

  /** Register
    @notice this function calls register internally without ID
  */
  function registerOnlyHash(
    bytes32 _vcHash,
    uint256 _exp,
    uint256 _nbf
  ) external {
    registerImp(BYTES_00_HASH, _vcHash, _exp, _nbf);
  }

  /** Register hash list
    @notice this function calls register internally with ID
    @param _vcIds id of the VC as Bytes of the UTF-8 encoded string
    @param _vcHashes list of keccak256 | SHA3 VC hashes
    @param _exp (Required) list of expiration dates as epoch time (seconds).
    @param _nbf (Optional = 0) list of not before date as epoch time (seconds). If not used set to 0.
  */
  function registerList(
    bytes[] memory _vcIds,
    bytes32[] memory _vcHashes,
    uint256[] memory _exp,
    uint256[] memory _nbf
  ) external {
    for (uint256 i = 0; i < _vcHashes.length; i++) {
      require(_vcIds[i].length > 5, "ID length should be greater than 5 bytes");
      registerImp(keccak256(_vcIds[i]), _vcHashes[i], _exp[i], _nbf[i]);
    }
  }

  /** Add ID
  @notice adds an ID to an alrready registered hash
  @notice hash needs to be registered without an ID
  @param _vcId id of the VC as Bytes of the URF-8 encoded string
  @param _vcHash keccak256 | SHA3 VC hash
  */
  function addId(bytes memory _vcId, bytes32 _vcHash) external {
    bytes32 vcIdHash = keccak256(_vcId);
    require(issuersCXC[_msgSender()], "Only CXC issuers are allowed");
    require(idToHash[vcIdHash] == bytes32(0), "VC state and hash alrready has an ID");
    require(statuses[_vcHash].state != States.UNREGISTERED, "VC Hash not registered");
    idToHash[vcIdHash] = _vcHash;
  }

  /** Update by ID
    @notice this function calls update internally with ID
    @param _vcId id of the VC as Bytes of the URF-8 encoded string
  */
  function updateById(
    bytes memory _vcId,
    uint256 _exp,
    uint256 _nbf
  ) external {
    bytes32 vcIdHash = keccak256(_vcId);
    update(vcIdHash, idToHash[vcIdHash], _exp, _nbf);
  }

  /** Update by Hash
    @notice this function calls update internally with hash
  */
  function updateByHash(
    bytes32 _vcHash,
    uint256 _exp,
    uint256 _nbf
  ) external {
    update(BYTES_00_HASH, _vcHash, _exp, _nbf);
  }

  /** Revoke List by ID
    @notice this function calls revokeById internally with ID
    @param _vcIds id VC list as Bytes[] of the URF-8 encoded string
  */
  function revokeListById(bytes[] memory _vcIds, string[] memory _reasons) external {
    for (uint256 i = 0; i < _vcIds.length; i++) {
      revokeById(_vcIds[i], _reasons[i]);
    }
  }

  /** Revoke List by Hash
    @notice this function calls revokeByHash internally with hash
    @param _vcHashes list of VC hashes to be revoked
  */
  function revokeListByHash(bytes32[] calldata _vcHashes, string[] calldata _reasons) external {
    for (uint256 i = 0; i < _vcHashes.length; i++) {
      revokeByHash(_vcHashes[i], _reasons[i]);
    }
  }

  // == External View ==

  /** Is CXC Issuer?
    @notice this function allows to check whether an address is a CXC Issuer
    @param issuer address to check
    @return true if the address is a CXC Issuer
  */
  function isCxcIssuer(address issuer) external view returns (bool) {
    return issuersCXC[issuer];
  }

  /** Get State By ID
    @notice Gets the state of a given VC hash
    @param _vcId id of the VC as Bytes of the URF-8 encoded string
    @param extTimestamp (optional) external timestamp to compare with,
    if not set it compares with the latest block timestamp
    @return _found boolean to know if something is found
    @return _state Actual state of the status updated to block.timestamp time
  */
  function getStateById(bytes memory _vcId, uint256 extTimestamp)
    external
    view
    returns (bool _found, string memory _state)
  {
    // search the hash if the Tx by the hash of the ID
    bytes32 vcHash = idToHash[keccak256(_vcId)];
    return getState(vcHash, extTimestamp);
  }

  /** Get State By Hash
    @notice Gets the state of a given VC hash
    @param _vcHash keccak256 | SHA3 VC hash
    @param extTimestamp (optional) external timestamp to compare with,
    if not set it compares with the latest block timestamp
    @return _found boolean to know if something is found
    @return _state Actual state of the status updated to block.timestamp time
  */
  function getStateByHash(bytes32 _vcHash, uint256 extTimestamp)
    external
    view
    returns (bool _found, string memory _state)
  {
    return getState(_vcHash, extTimestamp);
  }

  /** Get Status By ID
    @notice Gets the hole status of a given VC ID
    @param _vcId id of the VC as Bytes of the URF-8 encoded string
    @param extTimestamp (optional) external timestamp to compare with,
    if not set it compares with the latest block timestamp
  */
  function getStatusById(bytes memory _vcId, uint256 extTimestamp)
    external
    view
    returns (
      bool _found,
      string memory _state,
      uint256 _rat,
      uint256 _uat,
      uint256 _ext,
      uint256 _nbf
    )
  {
    // search the hash if the Tx by the hash of the ID
    bytes32 vcHash = idToHash[keccak256(_vcId)];
    return getStatus(vcHash, extTimestamp);
  }

  /** Get Status By Hash
    @notice Gets the hole status of a given VC hash
    @param _vcHash keccak256 | SHA3 VC hash
    @param extTimestamp (optional) external timestamp to compare with,
    if not set it compares with the latest block timestamp
  */
  function getStatusByHash(bytes32 _vcHash, uint256 extTimestamp)
    external
    view
    returns (
      bool _found,
      string memory _state,
      uint256 _rat,
      uint256 _uat,
      uint256 _ext,
      uint256 _nbf
    )
  {
    return getStatus(_vcHash, extTimestamp);
  }

  // == Public ==

  /** Revoke by ID
    @notice this function calls revoke internally with ID
    @param _vcId id of the VC as Bytes of the URF-8 encoded string
  */
  function revokeById(bytes memory _vcId, string memory _reason) public {
    bytes32 vcIdHash = keccak256(_vcId);
    revoke(vcIdHash, idToHash[vcIdHash], _reason);
  }

  /** Revoke by Hash
    @notice this function calls revoke internally with hash
    @param _vcHash VC hash to be revoked
  */
  function revokeByHash(bytes32 _vcHash, string memory _reason) public {
    revoke(BYTES_00_HASH, _vcHash, _reason);
  }

  // == Internal ==

  /** Register implementation
    @notice Register a new Verifiable Credential (VC) Hash
    @notice Only issuers in the initialized issuers list can register new VC hashes
    @notice VC hashes can only be registered once
    @param _vcIdHash keccak256 | SHA3 VC hash of the ID of the VC
    @param _vcHash keccak256 | SHA3 VC hash
    @param _exp (Required) expiration date as epoch time (seconds).
    @param _nbf (Optional = 0) not before date as epoch time (seconds). If not used set to 0.
  */
  function registerImp(
    bytes32 _vcIdHash,
    bytes32 _vcHash,
    uint256 _exp,
    uint256 _nbf
  ) internal {
    require(issuersCXC[_msgSender()], "Only CXC issuers are allowed");
    require(statuses[_vcHash].state == States.UNREGISTERED, "VC hash alrready registered");
    // register status
    VCStatus memory status = VCStatus(States.VALID, block.timestamp, block.timestamp, _exp, _nbf);
    statuses[_vcHash] = status;
    // you cannot compare bytes directly
    if (_vcIdHash != BYTES_00_HASH) {
      idToHash[_vcIdHash] = _vcHash;
    }
    // register issuer
    vcIssuers[_vcHash] = _msgSender();
    /* require(
      checkDates(_vcHash).state == States.VALID,
      "Cannot register a new VC hash with expired dates"
    ); */
    emit Registered(_vcIdHash, _vcHash, _msgSender());
    emit StatusChanged(
      _vcIdHash,
      _vcHash,
      States.UNREGISTERED,
      statuses[_vcHash].state,
      "Registered"
    );
  }

  /** Update implementation
    @notice Updates a Verifiable Credential (VC) Hash in case exp or nbf were bad registered
    @notice You probably DON'T have to use this method
    @notice Only the issuer who registered the VC hash can update it
    @notice VC hash has to be registered and be in a Valid state
    @param _vcIdHash keccak256 | SHA3 VC hash of the ID of the VC
    @param _vcHash keccak256 | SHA3 VC hash
    @param _exp (Required) expiration date as epoch time (seconds).
    @param _nbf (Optional = 0) not before date as epoch time (seconds). If not used set to 0.
  */
  function update(
    bytes32 _vcIdHash,
    bytes32 _vcHash,
    uint256 _exp,
    uint256 _nbf
  ) internal {
    // update VC status as of now, before check anything
    VCStatus storage status = updateDates(_vcIdHash, _vcHash);
    require(issuersCXC[_msgSender()], "Only CXC issuers are allowed");
    //require(vcIssuers[_vcHash] == _msgSender(), "Only issuer who registers this hash can update it");
    require(status.state != States.UNREGISTERED, "VC Hash not registered");
    // require(status.state == States.VALID, "This VC is not in valid state");

    // update dates
    status.exp = _exp;
    status.nbf = _nbf;
    status.uat = block.timestamp;

    // update VC status as of now, after dates change
    status = updateDates(_vcIdHash, _vcHash);
    emit Updated(_vcIdHash, _vcHash);
    emit StatusChanged(_vcIdHash, _vcHash, States.VALID, status.state, "Updated");
  }

  /** Revoke Implementation
    @notice Revoke a Verifiable Credential (VC) Hash
    @notice Only the issuer who registered the VC hash can revoke it
    @notice VC hash has to be registered and be in a Valid state
    @param _vcIdHash keccak256 | SHA3 VC hash of the ID of the VC
    @param _vcHash keccak256 | SHA3 VC hash
    @param _reason (Optional = "") string to show revoking reaon
  */
  function revoke(
    bytes32 _vcIdHash,
    bytes32 _vcHash,
    string memory _reason
  ) internal {
    // update VC status as of now, before check anything
    VCStatus storage status = updateDates(_vcIdHash, _vcHash);
    //require(vcIssuers[_vcHash] == _msgSender(), "Only issuer who registers this hash can revoke it");
    require(issuersCXC[_msgSender()], "Only CXC issuers are allowed");
    require(status.state != States.UNREGISTERED, "VC Hash not registered");
    require(status.state != States.REVOKED, "This VC have been revoked already");

    emit StatusChanged(_vcIdHash, _vcHash, States.VALID, States.REVOKED, _reason);
    emit Revoked(_vcIdHash, _vcHash);
    status.state = States.REVOKED;
    // updated at time
    status.uat = block.timestamp;
  }

  /** Update Dates
    @notice Updates the status of a VC hash if the dates asociated to it are not valid
    @notice This function does change the state
    @param _vcIdHash keccak256 | SHA3 VC hash of the ID of the VC
    @param _vcHash keccak256 | SHA3 VC hash
    @return _status Actual status updated to block.timestamp time
  */
  function updateDates(bytes32 _vcIdHash, bytes32 _vcHash)
    internal
    returns (VCStatus storage _status)
  {
    VCStatus storage status = statuses[_vcHash];
    // status conditions
    if (status.state != States.UNREGISTERED) {
      //         state == VALID        and             now < not before or             now >= expitation
      if (
        status.state == States.VALID &&
        (block.timestamp < status.nbf || block.timestamp >= status.exp)
      ) {
        // This changes the state of the status in the storage
        status.state = States.EXPIRED;
        emit StatusChanged(_vcIdHash, _vcHash, status.state, States.EXPIRED, "Dates expired");
        //      state == EXPIRED                and             now >= not before                now < expitation
      } else if (
        status.state == States.EXPIRED &&
        (block.timestamp >= status.nbf && block.timestamp < status.exp)
      ) {
        // This changes the state of the status in the storage
        status.state = States.VALID;
        emit StatusChanged(_vcIdHash, _vcHash, status.state, States.VALID, "Not Before reached");
      }
    }
    /* else if (status.state == States.UNREGISTERED) {}*/
    /* else if (status.state == States.REVOKED) {}*/
    return status;
  }

  /** Get State Implementation
    @notice Gets the state of a given VC hash
    @param _vcHash keccak256 | SHA3 VC hash
    @param extTimestamp (optional) external timestamp to compare with,
    if not set it compares with the latest block timestamp
    @return _found boolean to know if something is found
    @return _state Actual state of the status updated to block.timestamp time
  */
  function getState(bytes32 _vcHash, uint256 extTimestamp)
    internal
    view
    returns (bool _found, string memory _state)
  {
    uint256 timestamp = 0;
    if (extTimestamp == 0) {
      // check dates with timestamp of the latest generated block
      timestamp = block.timestamp;
    } else {
      // check dates with extenal timestamp
      timestamp = extTimestamp;
    }
    VCStatus memory status = _checkDates(_vcHash, timestamp);
    if (status.state != States.UNREGISTERED) {
      return (true, STATES_STR[status.state]);
    } else {
      return (false, "");
    }
  }

  /** Get Status Implementation
    @notice Gets the hole status of a given VC hash
    @param _vcHash keccak256 | SHA3 VC hash
    @param extTimestamp (optional) external timestamp to compare with,
    if not set it compares with the latest block timestamp
    @return _found boolean to know if something is found
    @return _state Actual state of the status updated to block.timestamp time
  */
  function getStatus(bytes32 _vcHash, uint256 extTimestamp)
    internal
    view
    returns (
      bool _found,
      string memory _state,
      uint256 _rat,
      uint256 _uat,
      uint256 _ext,
      uint256 _nbf
    )
  {
    uint256 timestamp = 0;
    if (extTimestamp == 0) {
      // check dates with timestamp of the latest generated block
      timestamp = block.timestamp;
    } else {
      // check dates with extenal timestamp
      timestamp = extTimestamp;
    }
    VCStatus memory status = _checkDates(_vcHash, timestamp);
    if (status.state != States.UNREGISTERED) {
      return (true, STATES_STR[status.state], status.rat, status.uat, status.exp, status.nbf);
    } else {
      return (false, "", 0, 0, 0, 0);
    }
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
    returns (VCStatus memory status)
  {
    status = statuses[vpHash];
    if (status.state != States.UNREGISTERED) {
      //         state == VALID         and       now < not before or       now >= expitation
      if (status.state == States.VALID && (timestamp < status.nbf || timestamp >= status.exp)) {
        // This does NOT change the status in storage
        status.state = States.EXPIRED;
        //      state == EXPIRED                and       now >= not before          now < expitation
      } else if (
        status.state == States.EXPIRED && (timestamp >= status.nbf && timestamp < status.exp)
      ) {
        // This does NOT change the status in storage
        status.state = States.VALID;
      }
    }
    return status;
  }
}
