import { DEPLOY, GAS_OPT } from "../configuration";
import { ghre } from "./utils";
import { Contract, ContractReceipt, Signer } from "ethers";
import yesno from "yesno";
import { CONTRACT } from "../configuration";
// Artifacts
import * as CodeTrust_Artifact from "node_modules/decentralized-code-trust/artifacts/contracts/CodeTrust.sol/CodeTrust.json";
import { saveDeployment } from "./deploy";
import { IRegularDeployment } from "models/Deploy";

const ethers = ghre.ethers;

const deployCodeTrust = async (deployer: Signer) => {
  if (CONTRACT.codeTrust.address) {
    const yes = await yesno({
      question: `Contract ${CONTRACT.codeTrust.name} has an address set to ${CONTRACT.codeTrust.address}. Continue to deploy new CodeTrust?`,
    });
    if (!yes) {
      throw new Error("Deployment aborted");
    }
  }
  const codeTrustFactory = await ethers.getContractFactoryFromArtifact(
    CodeTrust_Artifact,
    deployer
  );
  const codeTrust = await codeTrustFactory.deploy(GAS_OPT.max);
  const receipt = await codeTrust.deployTransaction.wait();
  if (!ethers.utils.isAddress(codeTrust.address)) {
    throw new Error(`Contract instance address is invalid: ${codeTrust.address}`);
  }
  if (!ethers.utils.isAddress(receipt.contractAddress)) {
    throw new Error(`Contract receipt address is invalid: ${receipt.contractAddress}`);
  }
  if (codeTrust.address != receipt.contractAddress) {
    throw new Error(
      `Contract addresses does not match: ${codeTrust.address}, ${receipt.contractAddress}`
    );
  }
  return {
    contractName: codeTrust.name,
    address: codeTrust.address,
    deployTxHash: receipt.transactionHash,
  } as IRegularDeployment;
};

const initialize = async (
  codeTrust: string,
  deployContractDeployer: boolean = true,
  existingContractRegistry?: string,
  existingContractDeployer?: string
) => {};
