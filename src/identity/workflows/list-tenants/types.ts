export namespace ListTenantsUseCaseTypes {
  export type Input = void;

  export type TenantItem = {
    id: string;
    name: string;
    createdAt: Date;
  };

  export type Output = { items: TenantItem[] };
}
