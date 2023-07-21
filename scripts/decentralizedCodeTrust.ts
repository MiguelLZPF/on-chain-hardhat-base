import { CONTRACTS } from "configuration";
import { Signer } from "ethers";
import yesno from "yesno";
import { gNetwork } from "scripts/utils";
import { deploy } from "scripts/deploy";
import { CodeTrust } from "node_modules/decentralized-code-trust/typechain-types";

const CONTRAC_NAME = "CodeTrust";

export const deployCodeTrust = async (deployer: Signer) => {
  // check if there is a previous deployment of CodeTrust
  const deployedAddress = CONTRACTS.get(CONTRAC_NAME)?.address.get(gNetwork.name);
  if (deployedAddress) {
    const yes = await yesno({
      question: `'${CONTRAC_NAME}' Contract has an address set to ${deployedAddress}. Continue to deploy new CodeTrust?`,
    });
    if (!yes) {
      throw new Error("Deployment aborted by user");
    }
  }
  // deploy using scripts/deploy
  const result = await deploy(CONTRAC_NAME, deployer, [], undefined, undefined, false);
  return { contractInstance: result.contractInstance as CodeTrust, deployment: result.deployment };
};
