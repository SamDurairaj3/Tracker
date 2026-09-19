import { getAuth } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handle(request: Request) {
  const response = await getAuth().handler(request);
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Pragma', 'no-cache');
  response.headers.append('Vary', 'Cookie');
  response.headers.append('Vary', 'Origin');
  return response;
}

export const GET = handle;
export const POST = handle;
