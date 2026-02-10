import React from 'react';

interface IconProps {
  name: string;
  className?: string;
  outlined?: boolean;
}

export const Icon: React.FC<IconProps> = ({ name, className = '', outlined = false }) => {
  const baseClass = outlined ? 'material-icons-outlined' : 'material-icons-round';
  return (
    <span className={`${baseClass} ${className}`}>
      {name}
    </span>
  );
};
