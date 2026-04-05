import { MaterialSymbol } from "../material-symbol";
import { SurfaceCard } from "./surfaces";
import { LabelSm, TitleMd } from "./typography";

type IssueCardProps = {
  tag: string;
  title: string;
  copy: string;
  infoTitle?: string;
};

export const IssueCard = ({ tag, title, copy, infoTitle }: IssueCardProps) => (
  <SurfaceCard className="ds-issue-card">
    <div className="mb-2 flex items-start justify-between">
      <LabelSm className="text-error">{tag}</LabelSm>
      <MaterialSymbol
        className="cursor-help text-[16px] text-on-surface-variant"
        icon="info"
        title={infoTitle}
      />
    </div>
    <TitleMd as="h4" className="mb-1 text-sm font-bold">
      {title}
    </TitleMd>
    <p className="text-xs leading-relaxed text-on-surface-variant">{copy}</p>
  </SurfaceCard>
);
