import { BLOCKCHAIN, GAS_OPT } from "../configuration";

export interface INetwork {
  chainId: number;
  name: string;
  url: string;
  nodeAddress: string;
  expiration: number;
}

export const networks = new Map<number | undefined, INetwork>([
  // [
  //   undefined,
  //   {
  //     chainId: BLOCKCHAIN.hardhat.chainId,
  //     name: "hardhat",
  //     url: `http://${BLOCKCHAIN.hardhat.hostname}:${BLOCKCHAIN.hardhat.port}`,
  //   },
  // ], // Default hardhat
  // [
  //   0,
  //   {
  //     chainId: BLOCKCHAIN.hardhat.chainId,
  //     name: "hardhat",
  //     url: `http://${BLOCKCHAIN.hardhat.hostname}:${BLOCKCHAIN.hardhat.port}`,
  //   },
  // ], // Default hardhat
  // [
  //   BLOCKCHAIN.hardhat.chainId,
  //   {
  //     chainId: BLOCKCHAIN.hardhat.chainId,
  //     name: "hardhat",
  //     url: `http://${BLOCKCHAIN.hardhat.hostname}:${BLOCKCHAIN.hardhat.port}`,
  //   },
  // ],
  [
    undefined || 0 || BLOCKCHAIN.lacchainLocal.chainId,
    {
      chainId: BLOCKCHAIN.lacchainLocal.chainId,
      name: "lacchain-local",
      url: `http://${BLOCKCHAIN.lacchainLocal.hostname}:${BLOCKCHAIN.lacchainLocal.port}`,
      nodeAddress: BLOCKCHAIN.lacchainLocal.nodeAddress,
      expiration: GAS_OPT.expiration,
    },
  ],
  [
    BLOCKCHAIN.lacchainProTest.chainId,
    {
      chainId: BLOCKCHAIN.lacchainProTest.chainId,
      name: "lacchain-protest",
      url: `http://${BLOCKCHAIN.lacchainProTest.hostname}:${BLOCKCHAIN.lacchainProTest.port}`,
      nodeAddress: BLOCKCHAIN.lacchainProTest.nodeAddress,
      expiration: GAS_OPT.expiration,
    },
  ],
]);

export interface IRegularDeployment {
  address: string;
  contractName?: string;
  deployTxHash?: string;
  deployTimestamp?: Date | number | string;
  byteCodeHash?: string;
}

export interface IUpgradeDeployment {
  admin: string;
  proxy: string; // or storage
  logic: string; // or implementation
  contractName?: string;
  proxyTxHash?: string;
  logicTxHash?: string;
  deployTimestamp?: Date | number | string;
  upgradeTimestamp?: Date | number | string;
  byteCodeHash?: string;
}

export interface INetworkDeployment {
  network: {
    name: string;
    chainId: number | string;
  };
  smartContracts: {
    proxyAdmins?: IRegularDeployment[];
    contracts: (IUpgradeDeployment | IRegularDeployment)[];
  };
}
