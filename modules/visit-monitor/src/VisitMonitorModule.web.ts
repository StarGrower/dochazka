import { registerWebModule, NativeModule } from 'expo';

import type { PendingEvent, VisitMonitorEvents } from './VisitMonitor.types';

// Appka běží jen na iOS - web stub existuje jen, ať typy/importy
// nespadnou, kdyby někdy někdo spustil `expo start --web`.
class VisitMonitorModule extends NativeModule<VisitMonitorEvents> {
  startVisitMonitoring(): void {}
  stopVisitMonitoring(): void {}
  startSignificantLocationMonitoring(): void {}
  stopSignificantLocationMonitoring(): void {}
  isSignificantLocationChangeMonitoringAvailable(): boolean {
    return false;
  }
  drainPendingEvents(): PendingEvent[] {
    return [];
  }
}

export default registerWebModule(VisitMonitorModule, 'VisitMonitorModule');
