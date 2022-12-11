// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0 <0.9.0;

// STRUCTS
/**
  States definition that maps into numbers
    - UNREGISTERED = 0,
    - VALID = 1,
    - REVOKED = 2,
    - EXPIRED = 3
*/
enum States {
  UNREGISTERED,
  VALID,
  REVOKED,
  EXPIRED
}
// Groups together the state and date/time properties as a VC's status at any given time
struct VCStatus {
  States state;
  uint256 rat; // Registered AT | registered Timestamp
  uint256 uat; // Updated AT | modified Timestamp
  uint256 exp; // EXPires at
  uint256 nbf; // Not BeFore. If == 0 --> not used (optional)
}

interface IVCRegistry {
  // EVENTS
  event Registered(bytes32 indexed vcIdHash, bytes32 indexed vcHash, address indexed byIssuer);
  event Updated(bytes32 indexed vcIdHash, bytes32 indexed vcHash);
  event Revoked(bytes32 indexed vcIdHash, bytes32 indexed vcHash);
  event StatusChanged(
    bytes32 vcIdHash,
    bytes32 indexed vcHash,
    States indexed prevState,
    States indexed actualState,
    string reason
  );
  event IdAdded(bytes32 indexed vcIdHash, bytes32 indexed vcHash);

  //event StateChecked(address indexed sender, bytes32 indexed vcHash, string state);

  // FUNCTIONS
  function initialize(address[] calldata _issuers) external;

  function addIssuer(address _newIssuer) external;

  function register(
    bytes calldata _id,
    bytes32 _vcHash,
    uint256 _exp,
    uint256 _nbf
  ) external;

  function registerOnlyHash(
    bytes32 _vcHash,
    uint256 _exp,
    uint256 _nbf
  ) external;

  function registerList(
    bytes[] calldata ids,
    bytes32[] calldata _vcHashes,
    uint256[] calldata _exp,
    uint256[] calldata _nbf
  ) external;

  function updateById(
    bytes calldata _vcId,
    uint256 _exp,
    uint256 _nbf
  ) external;

  function updateByHash(
    bytes32 _vcHash,
    uint256 _exp,
    uint256 _nbf
  ) external;

  function revokeById(bytes calldata _vcId, string calldata _reason) external;

  function revokeByHash(bytes32 _vcHash, string calldata _reason) external;

  function revokeListById(bytes[] calldata _vcIds, string[] calldata _reasons) external;

  function revokeListByHash(bytes32[] calldata _vcHashes, string[] calldata _reasons) external;

  function isCxcIssuer(address issuer) external view returns (bool);

  function getStateById(bytes calldata _vcId, uint256 extTimestamp)
    external
    view
    returns (bool _found, string calldata _state);

  function getStateByHash(bytes32 _vcHash, uint256 extTimestamp)
    external
    view
    returns (bool _found, string calldata _state);

  function getStatusById(bytes calldata _vcHash, uint256 extTimestamp)
    external
    view
    returns (
      bool _found,
      string calldata _state,
      uint256 _rat,
      uint256 _uat,
      uint256 _ext,
      uint256 _nbf
    );

  function getStatusByHash(bytes32 _vcHash, uint256 extTimestamp)
    external
    view
    returns (
      bool _found,
      string calldata _state,
      uint256 _rat,
      uint256 _uat,
      uint256 _ext,
      uint256 _nbf
    );
}
