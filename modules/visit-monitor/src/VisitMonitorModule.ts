import { NativeModule, requireNativeModule } from 'expo';

import type { PendingEvent, VisitMonitorEvents } from './VisitMonitor.types';

declare class VisitMonitorModule extends NativeModule<VisitMonitorEvents> {
  startVisitMonitoring(): void;
  stopVisitMonitoring(): void;
  startSignificantLocationMonitoring(): void;
  stopSignificantLocationMonitoring(): void;
  isSignificantLocationChangeMonitoringAvailable(): boolean;
  // Store-and-forward fronta (viz ios/VisitMonitorModule.swift) -
  // vrátí a vyprázdní události zachycené, než JS stihl zaregistrovat
  // listener (typicky hned po probuzení appky na pozadí).
  drainPendingEvents(): PendingEvent[];
}

export default requireNativeModule<VisitMonitorModule>('VisitMonitor');
