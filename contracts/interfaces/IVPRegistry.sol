// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0 <0.9.0;

// STRUCTS
/**
  States definition that maps into numbers
    - UNREGISTERED = 0,
    - REGISTERED = 1,
    - PRESENTED = 2,
    - CONSUMED = 3,
    - CANCELED = 10
  */
// Groups together the state and date/time properties as a VC's status at any given time
struct VPStatus {
  uint8 state;
  address[10] allowedVerifiers;
  address finalVerifier; // This is the verifier that consumes the VP
  bool valid; // it is valid if nbf < block.time < exp
  uint256 rat; // Registered AT | registered Timestamp
  uint256 uat; // Updated AT | modified Timestamp
  uint256 exp; // EXPires at
  uint256 nbf; // Not BeFore. If == 0 --> not used (optional)
}

interface IVPRegistry {
  // EVENTS
  event Registered(bytes32 indexed vpHash, address indexed from, address[10] to);
  event Presented(bytes32 indexed vpHash, address indexed verifier);
  event Consumed(bytes32 indexed vpHash, address indexed verifier);
  event StatusChanged(
    bytes32 indexed vpHash,
    uint8 indexed prevState,
    uint8 indexed actualState,
    bytes32 reason
  );
  event HashValid(bytes32 indexed vpHash, bool indexed valid);
  event NoStoragePolicy(
    bytes32 indexed vpHash,
    address indexed verifier,
    bytes32 message0,
    bytes15 message1
  );

  //FUNCTIONS
  function initialize() external;

  function register(
    bytes32 vpHash,
    address[10] calldata allowedVerifiers,
    uint256 exp,
    uint256 nbf
  ) external;

  function presented(bytes32 vpHash) external;

  function consumed(bytes32 vpHash) external;

  function cancel(bytes32 vpHash) external;

  function getStatus(bytes32 vpHash, uint256 extTimestamp)
    external
    view
    returns (bool found, VPStatus calldata status);
}
