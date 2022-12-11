export interface IExpectedStatus {
  found: boolean;
  state: number;
  allowedVerifiers: [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string
  ];
  finalVerifier: string;
  valid: boolean;
  rat?: number;
  uat?: number;
  exp?: number;
  nbf?: number;
}
