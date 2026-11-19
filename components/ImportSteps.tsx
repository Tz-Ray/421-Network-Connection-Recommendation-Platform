import React from 'react';
export const ImportSteps = ({ home = false }: { home?: boolean }) => (
  <ol className="steps">
    <li>
      On LinkedIn, open Settings, then Data privacy, then “Get a copy of your data”. Ask for the full archive.
    </li>
    <li>When LinkedIn emails you, download the .zip file.</li>
    <li>
      {home
        ? 'Continue to Search using the Import button below, then choose that file.'
        : 'Choose that file here.'}{' '}
      You will see what is read before anything is saved. Message text is never kept.
    </li>
  </ol>
);
