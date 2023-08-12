import { BytesLike } from "ethers";
import { ContractName } from "models/Configuration";
import { IContractRegistry, Ownable } from "standard-contract-registry/typechain-types";

//* Tasks Interfaces
export interface ISignerInformation {
  relativePath?: string;
  password: string;
  privateKey?: string;
  mnemonicPhrase?: string;
  mnemonicPath: string;
  mnemonicLocale: string;
}

export interface IGenerateWallets extends ISignerInformation {
  batchSize?: number;
  entropy?: string;
  type: string;
  connect: boolean;
}

export interface IGetWalletInfo {
  relativePath?: string;
  password: string;
  mnemonicPhrase?: string;
  mnemonicPath: string;
  mnemonicLocale: string;
  showPrivate: boolean;
}

export interface IGetMnemonic {
  relativePath: string;
  password: string;
}

//* Deployments
// Deploy with option to deploy upgradeable
export interface IDeploy extends ISignerInformation {
  upgradeable: boolean;
  contractName: ContractName;
  proxyAdmin?: string;
  contractArgs: any;
  initialize?: boolean;
  noCompile: boolean;
  txValue: number;
  tag?: string;
  storeOffChain?: boolean;
  storeOnChain?: boolean;
  recordName?: string;
  recordVersion?: string;
  contractRegistry?: string;
  contractDeployer?: string;
  upgradeableDeployer?: string;
}

export interface IUpgrade extends ISignerInformation {
  contractName: ContractName;
  proxy: string;
  proxyAdmin?: string;
  contractArgs: any;
  initialize?: boolean;
  tag?: string;
  noCompile: boolean;
}

export interface ICallContract extends ISignerInformation {
  contractName: ContractName;
  contractAddress: string;
  functionName: string;
  functionArgs: any;
  artifactPath: string;
}

export interface IGetLogic {
  proxy: string;
  proxyAdmin?: string;
}

export interface IChangeLogic extends ISignerInformation {
  proxy: string;
  proxyAdmin?: string;
  newLogic: string;
}

//* SCR
export interface IInitialize extends ISignerInformation {
  deployContractDeployer: boolean;
  existingCodeTrust?: string;
  existingContractRegistry?: string;
  existingContractDeployer?: string;
}

export interface IRegister extends ISignerInformation {
  recordVersion: string;
  contractName?: ContractName;
  recordName?: string;
  proxy?: string;
  logic?: string;
  logicCodeHash?: BytesLike;
  contractRegistry?: string | (IContractRegistry & Ownable);
}

export interface IUpdate extends ISignerInformation {
  recordVersion: string;
  contractName?: ContractName;
  recordName?: string;
  proxy?: string;
  logic?: string;
  newAdmin?: string;
  logicCodeHash?: BytesLike;
  contractRegistry?: string | (IContractRegistry & Ownable);
}

export interface IGetRecord extends ISignerInformation {
  recordName: string;
  admin?: string;
  recordVersion?: string;
  contractRegistry?: string | (IContractRegistry & Ownable);
}

export interface IGetRecords extends ISignerInformation {
  admin?: string;
  contractRegistry?: string | (IContractRegistry & Ownable);
}
