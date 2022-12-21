import { BytesLike } from "ethers/lib/utils";

export interface IDecodedRecord {
  name: string;
  proxy?: string;
  logic: string;
  admin: string;
  version: string;
  logicCodeHash: BytesLike;
  extraData?: BytesLike;
  timestamp: Date;
}
