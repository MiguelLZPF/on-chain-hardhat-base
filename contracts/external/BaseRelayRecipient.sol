// SPDX-License-Identifier:MIT
pragma solidity >=0.8.0 <0.9.0;

/**
 * A base contract to be inherited by any contract that want to receive relayed transactions
 * A subclass must use "_msgSender()" instead of "msg.sender"
 */
abstract contract BaseRelayRecipient {
  /*
   * Forwarder singleton we accept calls from
   */
  address internal trustedForwarder = 0x1Fa12c57ABab623beCc34A69cB526AD39c6338D6; // local

  // address internal trustedForwarder = 0x3B62E51E37d090453600395Ff1f9bdf4d7398404; // Protestnet

  /**
   * return the sender of this call.
   * if the call came through our Relay Hub, return the original sender.
   * should be used in the contract anywhere instead of msg.sender
   */
  function _msgSender() internal virtual returns (address sender) {
    bytes memory bytesSender;
    (, bytesSender) = trustedForwarder.call(abi.encodeWithSignature("getMsgSender()"));

    return abi.decode(bytesSender, (address));
  }
}
