import { AzureCliCredential } from "@azure/identity";

/** A person in the business tenant (a member, or a guest invited with their own email). */
export interface DirectoryUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
  mail?: string;
  userType?: string;
}

export interface Directory {
  find(emailOrUpn: string): Promise<DirectoryUser[]>;
}

// An apostrophe is legal in an address (o'brien@...), so it is allowed here and doubled in the filter below.
const EMAIL = /^[^\s"<>()]+@[^\s"<>()]+$/;

/**
 * Looks people up in Microsoft Entra ID through Microsoft Graph, with the signed-in admin's Azure CLI identity.
 * A guest's sign-in name looks like `name_domain#EXT#@tenant.onmicrosoft.com`, so both the user principal name and
 * the mail address are searched. Read-only: it needs the right every member has to read basic profiles.
 */
export class GraphDirectory implements Directory {
  private readonly credential: AzureCliCredential;

  constructor(private readonly opts: { tenantId?: string; getToken?: () => Promise<string>; fetchImpl?: typeof fetch } = {}) {
    this.credential = new AzureCliCredential(opts.tenantId ? { tenantId: opts.tenantId } : {});
  }

  private async token(): Promise<string> {
    if (this.opts.getToken) return this.opts.getToken();
    return (await this.credential.getToken("https://graph.microsoft.com/.default")).token;
  }

  async find(emailOrUpn: string): Promise<DirectoryUser[]> {
    const q = emailOrUpn.trim();
    if (!EMAIL.test(q)) throw new Error(`"${emailOrUpn}" does not look like an email address`);
    const esc = q.replace(/'/g, "''");
    const url = `https://graph.microsoft.com/v1.0/users?$filter=${encodeURIComponent(`userPrincipalName eq '${esc}' or mail eq '${esc}'`)}&$select=id,displayName,userPrincipalName,mail,userType`;
    const res = await (this.opts.fetchImpl ?? fetch)(url, { headers: { authorization: `Bearer ${await this.token()}` } });
    if (!res.ok) throw new Error(`Looking up ${q} in the directory failed (${res.status}). The signed-in admin may not be allowed to read users.`);
    return ((await res.json()) as { value: DirectoryUser[] }).value;
  }
}
