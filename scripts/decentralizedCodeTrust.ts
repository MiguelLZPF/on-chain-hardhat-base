import { CONTRACTS, GAS_OPT } from "configuration";
import { Signer, CallOverrides, PayableOverrides } from "ethers";
import { Provider } from "@ethersproject/providers";
import yesno from "yesno";
import { gNetwork, gProvider, getContractInstance } from "scripts/utils";
import { deploy } from "scripts/deploy";
import { CodeTrust } from "node_modules/decentralized-code-trust/typechain-types";
import { ICodeTrust } from "standard-contract-registry/typechain-types";

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
  const result = await deploy(CONTRAC_NAME, deployer, [], undefined, {
    offChain: false,
    onChain: false,
  });
  return { contractInstance: result.contractInstance as CodeTrust, deployment: result.deployment };
};

export async function trustCodeAt(
  trustedCode: string,
  signer: Signer,
  duration?: number,
  codeTrust?: ICodeTrust | string,
  overrides?: PayableOverrides
) {
  // check if signer is connected to the provider
  signer = signer.provider ? signer : signer.connect(gProvider);
  // get Code Trust contract instance
  codeTrust = await getContractInstance<ICodeTrust>("CodeTrust", signer, codeTrust);
  // duration from EOA and SC must be at least 10 seconds or less than 1 year
  const receipt = await (
    await codeTrust.trustCodeAt(trustedCode, duration || 120, overrides || GAS_OPT.max)
  ).wait();
  if (!receipt) {
    throw new Error("❌ ⛓️ Blockchain error. Receipt undefined.");
  }

  return await codeTrust.isTrustedCode(
    trustedCode,
    await signer.getAddress(),
    Math.floor(Date.now() / 1000)
  );
}

export async function isTrustedCode(
  trustedCode: string,
  trustedBy: string,
  signerOrProvider: Signer | Provider = gProvider,
  codeTrust?: ICodeTrust | string,
  overrides?: CallOverrides
) {
  // get Code Trust contract instance
  codeTrust = await getContractInstance<ICodeTrust>("CodeTrust", signerOrProvider, codeTrust);
  return await codeTrust.isTrustedCode(
    trustedCode,
    trustedBy,
    Math.floor(Date.now() / 1000),
    // overrides
  );
}
