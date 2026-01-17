/* istanbul ignore file */
import { NextRequest, NextResponse } from 'next/server';
import { handleLocalApiRequest } from '@/lib/local-api';

const LOCAL_API_ENABLED = process.env.LOCAL_API_MODE === 'true';

const localApiDisabled = () =>
  NextResponse.json(
    { error: { code: 'NOT_FOUND', message: 'Local API mode is disabled.' } },
    { status: 404 }
  );

const extractHeaders = (request: NextRequest): Record<string, string> => {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
};

const parseBody = async (request: NextRequest): Promise<unknown> => {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }
  const text = await request.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const handleRequest = async (
  request: NextRequest,
  params: { path?: string[] }
): Promise<NextResponse> => {
  if (!LOCAL_API_ENABLED) {
    return localApiDisabled();
  }

  const response = handleLocalApiRequest({
    method: request.method,
    path: params.path ?? [],
    query: request.nextUrl.searchParams,
    headers: extractHeaders(request),
    body: await parseBody(request),
  });

  if (response.isJson === false) {
    return new NextResponse(
      typeof response.body === 'string' ? response.body : String(response.body ?? ''),
      {
        status: response.status,
        headers: response.headers,
      }
    );
  }

  return NextResponse.json(response.body, {
    status: response.status,
    headers: response.headers,
  });
};

export async function GET(request: NextRequest, context: { params: { path?: string[] } }) {
  return handleRequest(request, context.params);
}

export async function POST(request: NextRequest, context: { params: { path?: string[] } }) {
  return handleRequest(request, context.params);
}

export async function PUT(request: NextRequest, context: { params: { path?: string[] } }) {
  return handleRequest(request, context.params);
}

export async function PATCH(request: NextRequest, context: { params: { path?: string[] } }) {
  return handleRequest(request, context.params);
}

export async function DELETE(request: NextRequest, context: { params: { path?: string[] } }) {
  return handleRequest(request, context.params);
}
