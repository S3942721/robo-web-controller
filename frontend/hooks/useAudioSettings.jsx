import { createContext, useContext, useState } from 'react';
import PropTypes from 'prop-types';

const AudioSettingsContext = createContext(null);

export function AudioSettingsProvider({ children }) {
  const [volume, setVolume] = useState(1.0);

  return (
    <AudioSettingsContext.Provider value={{ volume, setVolume }}>
      {children}
    </AudioSettingsContext.Provider>
  );
}

AudioSettingsProvider.propTypes = {
  children: PropTypes.node.isRequired
};

export function useAudioSettings() {
  return useContext(AudioSettingsContext);
}
