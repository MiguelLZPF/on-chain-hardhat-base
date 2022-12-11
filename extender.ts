import "@nomiclabs/hardhat-ethers";
import { extendEnvironment } from "hardhat/config";
import { lazyObject } from "hardhat/plugins";
import "./type-extensions";

import { GasModelProvider, GasModelSigner } from "@lacchain/gas-model-provider";
import { ContractFactory } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HttpNetworkUserConfig } from "hardhat/types/config";

extendEnvironment((hre: HardhatRuntimeEnvironment) => {
  hre.lacchain = lazyObject(() => {
    const gasModelProvider = new GasModelProvider(
      (hre.network.config as HttpNetworkUserConfig).url
    );

    return {
      provider: gasModelProvider,
      getSigners: () => {
        const { privateKeys, nodeAddress, expiration } = hre.network
          .config as HttpNetworkUserConfig;
        return (privateKeys || []).map(
          (privateKey: string) =>
            new GasModelSigner(privateKey, gasModelProvider, nodeAddress, expiration)
        );
      },
      deployContract: async (contract: ContractFactory, ...params) => {
        const instance = await contract.deploy(...params);
        const receipt = await instance.deployTransaction.wait();
        return new hre.ethers.Contract(
          receipt.contractAddress,
          contract.interface,
          contract.signer
        );
      },
    };
  });
});
