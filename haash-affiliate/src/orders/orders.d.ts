export interface OrderCampaignProps {
  referralId: string;
  campaignAccessKey: string;
  orderId: string;
  productDetails: OrderCampaignProducts[];
}
export interface OrderCampaignProducts {
  productId: string;
  productAmount: number;
}
//
export function OrderCampaign(props: OrderCampaignProps): Promise<any>;

export function CancelCommission(orderId: string, productId: string): Promise<any>;
