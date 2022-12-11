import { expect } from "chai";
import { ghre } from "./utils";
import { Contract } from "ethers";
import { recoverAddress, BytesLike } from "ethers/lib/utils";
import { Provider } from "@ethersproject/abstract-provider";
import { SignatureLike } from "@ethersproject/bytes";
import { IExpectedStatus } from "../models/Test";
import { ICredentialRequest, IStoredVC, TOperator } from "models/CXCFlows";
import { IVPRegistry, VPRegistry, VPRegistry__factory } from "../typechain-types";

//* cxcFlows

/**
 * Given a presentation request and an array of stored credentials,
 * it gets credentials that meet the requirements
 * @param presentationRequest presentation request to compare claims against
 * @param storedVCs actual stored credentials
 * @returns list of compliant credentials
 */
export const getValidVCs = async (
  presentationRequest: ICredentialRequest[],
  storedVCs: IStoredVC[]
) => {
  let vcsToPresent = []; //! to store the VCs as JSON Objects
  // for each VC stored
  for (const vcStored of storedVCs) {
    // decode each VC to check claims
    let verifiableCredential = JSON.parse(Buffer.from(vcStored.vc64, "base64").toString());
    for (const credentialReq of presentationRequest) {
      if ((verifiableCredential.type as string[]).includes(credentialReq.vcType)) {
        // this VC has a type that match the presentation request vc type
        if (credentialReq.claims) {
          // there are claim restrictions
          // for each claim request
          let validClaims = 0;
          for (const claimReq of credentialReq.claims) {
            const claim = verifiableCredential.credentialSubject[claimReq.key];
            if (claim) {
              // claim exists in vc
              if (!(await isTrue(claim, claimReq.operator, claimReq.value))) {
                break; // out of claim loop
              }
              validClaims++;
              if (validClaims == credentialReq.claims.length) {
                vcsToPresent.push(verifiableCredential);
              }
            } else {
              // claim key not found in this verifiable credential
              break; // out of claim loop
            }
          }
        } else {
          // there are no claim restrictions
          vcsToPresent.push(verifiableCredential);
        }
      }
      //* else do nothing and go for next credential request
    }
  }

  return vcsToPresent;
};

/**
 * Given a presentation request and an array of credentials, it checks that every credential is valid
 * @param presentationRequest presentation request to compare claims against
 * @param verifiableCredentials actual credentials extracted from VP
 * @returns true if all credentials are valid, false otherwise
 */
export const checkClaims = async (
  presentationRequest: ICredentialRequest[],
  verifiableCredentials: any[]
) => {
  let validVCs = 0; //! at the end must be == to vc.length
  // for each VC
  for (const verifiableCredential of verifiableCredentials) {
    for (const credentialReq of presentationRequest) {
      if ((verifiableCredential.type as string[]).includes(credentialReq.vcType)) {
        // this VC has a type that match the presentation request vc type
        if (credentialReq.claims) {
          // there are claim restrictions
          // for each claim request
          let validClaims = 0;
          for (const claimReq of credentialReq.claims) {
            const claim = verifiableCredential.credentialSubject[claimReq.key];
            if (claim) {
              // claim exists in vc
              if (!(await isTrue(claim, claimReq.operator, claimReq.value))) {
                break; // out of claim loop
              }
              validClaims++;
              if (validClaims == credentialReq.claims.length) {
                validVCs++;
              }
            } else {
              // claim key not found in this verifiable credential
              break; // out of claim loop
            }
          }
        } else {
          // there are no claim restrictions
          validVCs++;
        }
      }
      //* else do nothing and go for next credential request
    }
  }
  return validVCs == verifiableCredentials.length ? true : false;
};

/**
 * Checks if claimValue complies with operator and reqValue
 * @param claimValue actual claim value expected from VP
 * @param operator operator used to compare values
 * @param reqValue required claim value
 * @returns true if complies condition, false otherwise
 */
export const isTrue = async (claimValue: any, operator: TOperator, reqValue: any) => {
  switch (operator) {
    case "=":
      if (claimValue == reqValue) {
        return true;
      } else {
        return false;
      }
    case "==":
      if (claimValue == reqValue) {
        return true;
      } else {
        return false;
      }
    case "!=":
      if (claimValue != reqValue) {
        return true;
      } else {
        return false;
      }
    //* onwards operators are meant to be used with numbers
    case "<=":
      if (+claimValue <= +reqValue) {
        return true;
      } else {
        return false;
      }
    case ">=":
      if (+claimValue >= +reqValue) {
        return true;
      } else {
        return false;
      }
    case "<":
      if (+claimValue < +reqValue) {
        return true;
      } else {
        return false;
      }
    case ">":
      if (+claimValue > +reqValue) {
        return true;
      } else {
        return false;
      }
    default:
      return false;
  }
};

/**
 * Check that a given signature was made with a private key
 * related to a address (public key) registered in the DID Document of the
 * given signer
 * @param signature signature to check
 * @param signed bytes that where signed
 * @param signer address of the signer to compare with
 * @param resolver lacchain resolver to get assertion DID Document
 * @returns a boolean indicating whether the signature is valid or not
 */
export const checkSignature = async (
  signature: SignatureLike,
  signed: BytesLike,
  signer: string,
  resolver: any
) => {
  const document = resolver.lac(signer);
  const addrFromSign = recoverAddress(signed, signature);
  // -- get assertion array from document
  // -- check that the address from signature is in one of the authentication methods fo the DID Document
  let valid = false;
  ((await document).assertionMethod as any[]).forEach((assertion) => {
    if (assertion.blockchainAccountId == addrFromSign) {
      valid = true;
    }
  });
  return valid;
};

//* test
/**
 * Helper test function to check status of a VP
 * @param vpRegistry VPRegistry SC address
 * @param vpHash VP hash that identifies the VP
 * @param expected expected parameters to compare with
 * @param provider (optional) provider to use
 */
export const checkVpStatus = async (
  vpRegistry: VPRegistry,
  vpHash: BytesLike,
  expected: IExpectedStatus,
  provider?: Provider
) => {
  // if no provider as parameter, use the hardhat one
  provider = provider ? provider : ghre.ethers.provider;
  const result = await vpRegistry.getStatus(vpHash, Math.floor(Date.now() / 1000));
  // console.log(Math.floor(Date.now() / 1000), expected.exp, expected.nbf);

  expect(result.found).to.equal(expected.found);
  expect(result.status.valid).to.equal(expected.valid);
  expect(result.status.state).to.equal(expected.state);
  result.status.allowedVerifiers.forEach(async (verifier: string, index: number) => {
    expect(verifier).to.equal(expected.allowedVerifiers[index]);
  });
  expect(result.status.finalVerifier).to.equal(expected.finalVerifier);
  expect(result.status.rat).to.equal(expected.rat);
  if (expected.uat) {
    expect(result.status.uat).to.equal(expected.uat);
  }
  expect(result.status.exp).to.equal(expected.exp);
  expect(result.status.nbf).to.equal(expected.nbf);
};
