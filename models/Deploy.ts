import { ContractName, NetworkName } from "models/Configuration";
import { Contract, BytesLike } from "ethers";
import { ProxyAdmin, TransparentUpgradeableProxy } from "typechain-types";
import { IDecodedRecord } from "./StandardContractRegistry";

// Where to store type
export type WhereToStore = "onchain" | "offchain" | "both" | "Both" | "OnChain" | "OffChain";

interface IDeployment {
  contractName: ContractName;
  deployTimestamp?: Date | number | string;
  byteCodeHash?: BytesLike; // this is the "deployBytecode" not the bytecode
  tag?: string; // open field to add metadata or any info to a deployment
}

export interface IRegularDeployment extends IDeployment {
  address: string;
  deployTxHash?: string;
}

export interface IUpgradeDeployment extends IDeployment {
  admin: string;
  proxy: string; // or storage
  logic: string; // or implementation
  proxyDeployTxHash?: string;
  logicDeployTxHash?: string;
  upgradeTimestamp?: Date | number | string;
}

export interface INetworkDeployment {
  network: {
    name: NetworkName;
    chainId: number;
  };
  smartContracts: {
    proxyAdmins?: IRegularDeployment[];
    contracts: (IUpgradeDeployment | IRegularDeployment)[];
  };
}

export interface IDeployReturn {
  deployment?: IRegularDeployment;
  record?: IDecodedRecord;
  recordUpdated?: boolean;
  previousRecord?: IDecodedRecord;
  contractInstance: Contract;
}

export interface IUpgrDeployReturn extends Omit<IDeployReturn, "deployment"> {
  deployment?: IUpgradeDeployment;
  record?: IDecodedRecord;
  adminDeployment?: IRegularDeployment;
  logicInstance: Contract;
  tupInstance: TransparentUpgradeableProxy | Contract;
  proxyAdminInstance?: ProxyAdmin;
}

export interface IStorageOptions {
  onChain: boolean;
  offChain: boolean;
  scr?: { version?: string; recordName?: string; contractRegistry?: string };
  tag?: string;
}
