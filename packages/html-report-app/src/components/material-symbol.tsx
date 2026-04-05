type MaterialSymbolProps = {
  icon: string;
  className?: string;
};

export const MaterialSymbol = ({ icon, className }: MaterialSymbolProps) => (
  <span
    className={["material-symbols-outlined", className].filter(Boolean).join(" ")}
    data-icon={icon}
  >
    {icon}
  </span>
);
