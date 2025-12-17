import { createThirdwebClient, type ThirdwebClient } from 'thirdweb';

const DEFAULT_THIRDWEB_CLIENT_ID = 'b64ae0a29a7cf670955ace57236dc1f0';

export const THIRDWEB_CLIENT_ID = (process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || DEFAULT_THIRDWEB_CLIENT_ID).trim();

export const thirdwebClient: ThirdwebClient | null = THIRDWEB_CLIENT_ID
  ? createThirdwebClient({ clientId: THIRDWEB_CLIENT_ID })
  : null;

export const thirdwebAppMetadata = {
  name: 'xmtp.mx',
};
