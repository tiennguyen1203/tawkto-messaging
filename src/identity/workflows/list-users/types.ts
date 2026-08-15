export namespace ListUsersUseCaseTypes {
  export type Input = { tenantId: string };

  export type UserItem = {
    id: string;
    tenantId: string;
    email: string;
    displayName: string;
    roles: string[];
  };

  export type Output = { items: UserItem[] };
}
