import "hardhat/types/runtime";
import "hardhat/types/config";
import { Contract, ContractFactory } from "ethers";
import { GasModelProvider, GasModelSigner } from "@lacchain/gas-model-provider";

declare module "hardhat/types/config" {
  interface HttpNetworkUserConfig {
    nodeAddress: string;
    expiration: number;
    chainId?: number;
    from?: string;
    gas?: "auto" | number;
    gasPrice?: "auto" | number;
    gasMultiplier?: number;
    url?: string;
    timeout?: number;
    httpHeaders?: {
      [name: string]: string;
    };
    privateKeys?: string[];
  }
}

declare module "hardhat/types/runtime" {
  interface HardhatRuntimeEnvironment {
    lacchain: {
      provider: GasModelProvider;
      deployContract: (contract: ContractFactory, ...params: any) => Promise<Contract>;
      getSigners: () => GasModelSigner[];
    };
  }
}
