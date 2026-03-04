const markerRegex = /\b(?:TODO|FIXME)\b/gi;

const countMarkers = (text: string): number => text.match(markerRegex)?.length ?? 0;

export const countTodoFixmeInComments = (content: string): number => {
  const lines = content.split(/\r?\n/u);
  let total = 0;
  let inBlockComment = false;

  for (const line of lines) {
    let cursor = 0;

    while (cursor < line.length) {
      if (inBlockComment) {
        const blockEnd = line.indexOf("*/", cursor);
        if (blockEnd === -1) {
          total += countMarkers(line.slice(cursor));
          cursor = line.length;
          continue;
        }

        total += countMarkers(line.slice(cursor, blockEnd));
        inBlockComment = false;
        cursor = blockEnd + 2;
        continue;
      }

      const lineCommentStart = line.indexOf("//", cursor);
      const blockCommentStart = line.indexOf("/*", cursor);

      if (lineCommentStart === -1 && blockCommentStart === -1) {
        break;
      }

      if (
        lineCommentStart !== -1 &&
        (blockCommentStart === -1 || lineCommentStart < blockCommentStart)
      ) {
        total += countMarkers(line.slice(lineCommentStart + 2));
        break;
      }

      if (blockCommentStart !== -1) {
        const blockEnd = line.indexOf("*/", blockCommentStart + 2);
        if (blockEnd === -1) {
          total += countMarkers(line.slice(blockCommentStart + 2));
          inBlockComment = true;
          break;
        }

        total += countMarkers(line.slice(blockCommentStart + 2, blockEnd));
        cursor = blockEnd + 2;
      }
    }
  }

  return total;
};
