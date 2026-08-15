export namespace IssueTokenUseCaseTypes {
  export type Input = { userId: string };

  export type Output = {
    accessToken: string;
    expiresIn: string;
    user: {
      id: string;
      tenantId: string;
      email: string;
      displayName: string;
      roles: string[];
    };
  };
}
