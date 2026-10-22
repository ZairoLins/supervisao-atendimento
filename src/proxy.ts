import { NextResponse, type NextRequest } from "next/server";

/**
 * Verificação otimista: sem cookie de sessão, redireciona para o login.
 * A validação real da sessão e as permissões são verificadas no servidor em cada
 * página, Server Action e Route Handler (camada de acesso a dados).
 */
export function proxy(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get("sv_session")?.value);
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|woff2?)$).*)"],
};
