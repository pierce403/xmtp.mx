import { createThirdwebClient, type ThirdwebClient } from 'thirdweb';

export const THIRDWEB_CLIENT_ID = process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID;

export const thirdwebClient: ThirdwebClient | null = THIRDWEB_CLIENT_ID
  ? createThirdwebClient({ clientId: THIRDWEB_CLIENT_ID })
  : null;

export const thirdwebAppMetadata = {
  name: 'xmtp.mx',
};

