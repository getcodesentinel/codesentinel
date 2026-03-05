import * as ts from "typescript";

const markerRegex = /\b(?:TODO|FIXME)\b/gi;

const countMarkers = (text: string): number => text.match(markerRegex)?.length ?? 0;

export const countTodoFixmeInComments = (content: string): number => {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    content,
  );
  let total = 0;
  let token = scanner.scan();

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      total += countMarkers(scanner.getTokenText());
    }
    token = scanner.scan();
  }

  return total;
};
