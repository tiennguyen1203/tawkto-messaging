export namespace CreateTenantUseCaseTypes {
  export type Input = { name: string };

  export type Output = {
    id: string;
    name: string;
    createdAt: Date;
  };
}
