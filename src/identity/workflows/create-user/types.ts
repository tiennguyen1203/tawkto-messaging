export namespace CreateUserUseCaseTypes {
  export type Input = {
    tenantId: string;
    email: string;
    displayName: string;
    roles: string[];
  };

  export type Output = {
    id: string;
    tenantId: string;
    email: string;
    displayName: string;
    roles: string[];
  };
}
