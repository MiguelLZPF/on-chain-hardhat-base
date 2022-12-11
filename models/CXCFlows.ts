import { KeyObject } from "crypto";
import { Wallet } from "ethers";
import { Mnemonic } from "ethers/lib/utils";
import DID from "scripts/lacchainDid/did.js";
import { IVCRegistry, IVPRegistry } from "../typechain-types";

export type TOperator = "=" | "==" | "!=" | "<=" | ">=" | "<" | ">";
export interface IStudent {
  ucn: string;
  did?: string;
  secretKey: {
    key: string;
    validated: boolean;
  };
  vcIdList: string[];
}

export interface IStoredVC {
  id: string;
  hash?: string;
  vc64: string;
}

export interface IDDResult {
  elapsedTime?: number; // seconds
  requestedVCs: number;
  successfulIssuances: number;
  failedIssuances: number;
  failedDetail?: [
    {
      did: string;
      error: string;
    }
  ];
}

export interface IClaimRequest {
  key: string;
  operator: TOperator;
  value: string;
}

export interface ICredentialRequest {
  vcType: string;
  claims?: IClaimRequest[];
}

export interface IPendingPresentations {
  vpRequest: ICredentialRequest[];
  valid: boolean;
}

//export interface IAcademicID {}

export interface ICXC {
  students: Map<string, IStudent>; // UCN, IStudent
  didToUcn: Map<string, string>; // DID, UCN
  academicIds: Map<string, IStoredVC>; // <id, vc64>
  digitalDiplomas: Map<string, IStoredVC>; // <id, vc64>
}

export interface IBackend {
  wallet?: Wallet;
  mnemonicPhrase?: Mnemonic;
  DID?: DID;
  secretKeys: string[];
  rsaKeys?: {
    docId?: string;
    privateKey: KeyObject;
    publicKey: KeyObject;
  };
  vcRegistry?: IVCRegistry;
  vpRegistry?: IVPRegistry;
  tempMemory?: any;
}

export interface IWalletApp {
  ucn: string;
  secretKey?: string;
  wallet?: Wallet;
  mnemonicPhrase?: Mnemonic;
  DID?: DID;
  vcRegistry?: IVCRegistry;
  vpRegistry?: IVPRegistry;
  sessionToken?: string;
  academicId?: IStoredVC;
  digitalDiplomas: Map<string, IStoredVC>;
  tempMemory?: {
    presentId?: string;
    presentEndPoint?: string;
    vcsToPresent?: any[]; // JSON object[]
    verifPresent?: any;
  };
}

export interface IVerifier {
  wallet?: Wallet;
  mnemonicPhrase?: Mnemonic;
  DID?: DID;
  vcRegistry?: IVCRegistry;
  vpRegistry?: IVPRegistry;
  pendingPresentations?: Map<string, IPendingPresentations>; // accessID => {vpRequest, valid}
  tempMemory?: {
    vpRequest?: ICredentialRequest[];
    vp64?: string;
    verifPresent?: any;
  };
}

// Represents the HTTP exchanges (body info) between the entities
export interface IHTTPbodies {
  onBoarding: {
    // CXC -> Backend
    createSecretKey_req?: {
      ucn: string;
    };
    // Backend -> CXC
    createSecretKey_res?: {
      created: boolean;
      ucn: string;
      secretKey?: string;
    };
    // CXC -> Wallet
    secretKey_email?: {
      secretKey: string;
    };
    // Wallet -> Backend
    dataValidation_req?: {
      ucn: string;
      secretKey: string;
      did: string;
      signature: string;
    };
    // Backend -> Wallet
    dataValidation_res?: {
      validated: boolean;
      sessionToken?: string;
    };
    // Backend -> CXC
    storeStudentInfo_req?: {
      ucn: string;
      secretKey: string;
      did: string;
    };
    // CXC -> Backend
    storeStudentInfo_res?: {
      stored: boolean;
    };
  };
  academicIDcreation: {
    academicId_req?: {
      sessionToken: string;
    };
    academicId_res?: {
      created: boolean;
      academicId?: string; // base64?? // : IAcademicID;
    };
    studentData_req?: {
      did: string;
    };
    studentData_res?: {
      ucn: string;
      firstName: string;
      middleName: string;
      lastName: string;
      dateOfBirth: string;
      gender: string;
      underAge?: number;
      guardians?: string[];
      photoUrl?: string;
      photoUrlSign?: string;
    };
    storeAcademicId_req?: {
      academicId_id: string;
      academicId: string;
    };
    storeAcademicId_res?: {
      stored: boolean;
    };
  };
  sessionTokenRefresh: {
    sessionTokenRefresh_req?: {
      did: string;
      signature: string;
    };
    sessionTokenRefresh_res?: {
      validated: boolean;
      sessionToken?: string;
    };
    checkDidCXC_req?: {
      did: string;
    };
    checkDidCXC_res?: {
      exists: boolean;
    };
  };
  digDiplomaIssuance: {
    ddIssuance_req?: {
      dids: string[];
      diplomaType: string;
      callbackURL: string;
    };
    ddIssuance_res?: {
      received: boolean;
      // Enable optional URL for CXC to check progress
      progressURL?: string;
      warning?: string;
    };
    diplomaData_req?: {
      did: string;
      diplomaType: string;
    };
    diplomaData_res?: {
      examYear: string;
      examSession: string;
      examSessionDescription: string;
      centreCode: string;
      centreName: string;
      territoryCode: string;
      territoryName: string;
      candidateNumber: string;
      subjectCode: string;
      subject: string;
      overallGrade: string;
      profile1Grade: string;
      profile2Grade: string;
      profile3Grade: string;
      profile4Grade: string;
      profile5Grade: string;
    };
    storeDigDip_req?: {
      digitalDiploma_id: string;
      digitalDiploma: string;
      student: string;
    };
    storeDigDip_res?: {
      stored: boolean;
    };
    ddResults_req?: {
      result: IDDResult;
    };
    ddResults_res?: {
      ok: boolean;
    };
  };
  digDiplomaUpdate: {
    update_req?: {
      sessionToken: string;
      actualDDList: string[];
    };
    update_res?: {
      new: boolean;
      newVCs: {
        id: string;
        vc64: string;
      }[];
    };
    cxcDDList_req?: {
      studentDid: string;
    };
    cxcDDList_res?: {
      vcList: {
        id: string;
        vc64: string;
      }[];
    };
  };
  vcRevocation: {
    revoke_req?: {
      vcIds: string[];
      reasons?: string | string[];
    };
    revoke_res?: {
      revoked: boolean;
    };
  };
  presentationOnline: {
    vpRequest_qr?: {
      verifierDid: string;
      serviceType: string;
      presentationRequest: ICredentialRequest[];
      signature: string;
      aditionalData?: {
        requestId: string;
      };
    };
    proxySendPresentation_req?: {
      serviceEndpoint: string;
      requestId: string;
      vp: string;
    };
    sendPresentation_req?: {
      requestId: string;
      vp: string;
    };
    sendPresentation_res?: {
      requestId: string;
      valid: true;
    }
    proxySendPresentation_res?: {
      requestId: string;
      valid: true;
    }
  };
}
