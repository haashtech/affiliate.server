export interface InitAffiliateProps {
  baseURL?: string;
  apiKey?: string;
  domain?: string;
}

export function InitAffiliate(config: InitAffiliateProps): void;

export interface AffiliateConfig {
  baseURL: string;
  apiKey?: string;
  domain?: string;
}

export function getConfig(): AffiliateConfig;
