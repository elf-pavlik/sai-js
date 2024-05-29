import type { interactionPolicy } from '@solid/community-server/templates/types/oidc-provider'
import { 
  importOidcProvider,
  getLoggerFor,
  PromptFactory } from '@solid/community-server';

export class CreatePromptFactory extends PromptFactory {
  protected readonly logger = getLoggerFor(this);

  public async handle(policy: interactionPolicy.DefaultPolicy): Promise<void> {
    const { interactionPolicy: ip } = await importOidcProvider();
    this.addCreatePrompt(policy, ip);
  }

  // eslint-disable-next-line class-methods-use-this
  private addCreatePrompt(policy: interactionPolicy.DefaultPolicy, ip: typeof interactionPolicy): void {
    const createPrompt = new ip.Prompt({ name: "create", requestable: true });
    policy.add(createPrompt, 0);
  }
}
