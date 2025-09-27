import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ComponentConfigService, ComponentConfig, ComponentDataSource, ComponentSchedule } from '../../services/component-config.service';
import { environment } from '../../../environments/environment';

@Component({
 selector: 'app-component-configuration',
 standalone: true,
 imports: [CommonModule, FormsModule],
 templateUrl: './component-configuration.component.html',
 styleUrls: ['./component-configuration.component.css']
})
export class ComponentConfigurationComponent implements OnInit {
 components: ComponentConfig[] = [];
 loading = false;
 
 // Modal state
 showConfigModal = false;
 showFrequencyModal = false;
 private frequencyResolve: ((value: string | null) => void) | null = null;
 selectedComponent: ComponentConfig | null = null;
 selectedMethod: string = 'manual';
 dataSource: ComponentDataSource = { type: 'manual' };
 schedule: ComponentSchedule = { frequency: 'manual', enabled: false };
 private timerInterval: any;
 componentTimers: { [key: number]: number } = {};
 
 // Custom component modal state
 showCustomComponentModal = false;
 customComponent = {
   name: '',
   category: '',
   maxValue: 10
 };

 showConfirmModal = false;
 confirmModalData: {
   title: string;
   message: string;
   confirmText: string;
   cancelText: string;
   onConfirm: () => void;
   onCancel: () => void;
 } = {
   title: '',
   message: '',
   confirmText: 'OK',
   cancelText: 'Cancel',
   onConfirm: () => {},
   onCancel: () => {}
 };

 testing = false;
 testResults: any = null;
 saving = false;

 notifications: Array<{
 id: number;
 type: 'success' | 'info' | 'warning' | 'error';
 title: string;
 message: string;
 timestamp: number;
}> = [];

private notificationId = 0;
 
 methods = [
   { id: 'manual', name: 'Manual Input', description: 'Manually set scores for each node' },
   { id: 'database', name: 'Database Query', description: 'Pull scores from external database' },
   { id: 'api', name: 'API Integration', description: 'Fetch from external API endpoint' },
   { id: 'file', name: 'File Upload', description: 'Import scores from spreadsheet' },
   { id: 'script', name: 'Custom Script', description: 'Write custom calculation logic' }
 ];

updateFrequencies = [
  { value: 'manual', label: 'Manual Only' },
  { value: 'minute', label: 'Every Minute (Testing)' },
  { value: 'hourly', label: 'Every Hour' },
  { value: 'daily', label: 'Once Daily' },
  { value: 'weekly', label: 'Once Weekly' },
  { value: 'monthly', label: 'Once Monthly' }
];

 constructor(private componentConfigService: ComponentConfigService,
             private http: HttpClient
 ) { }

 ngOnInit(): void {
   this.loadComponents();
 }

 ngOnDestroy() {
   if (this.timerInterval) {
     clearInterval(this.timerInterval);
   }
 }

 // Replace the existing configureComponent method
configureComponent(component: ComponentConfig): void {
  this.selectedComponent = component;
  this.askUpdateFrequency().then(frequency => {
    if (frequency) {
      this.saveComponentFrequency(frequency);
    }
  });
}

private askUpdateFrequency(): Promise<string | null> {
  return new Promise((resolve) => {
    this.schedule.frequency = this.selectedComponent?.schedule?.frequency || 'manual';
    this.frequencyResolve = resolve;
    this.showFrequencyModal = true;
  });
}

confirmFrequency(): void {
  if (this.frequencyResolve) {
    this.frequencyResolve(this.schedule.frequency);
    this.frequencyResolve = null;
  }
  this.showFrequencyModal = false;
}

cancelFrequencyModal(): void {
  if (this.frequencyResolve) {
    this.frequencyResolve(null);
    this.frequencyResolve = null;
  }
  this.showFrequencyModal = false;
}

setFrequency(value: string): void {
  this.schedule.frequency = value as 'manual' | 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly';
}

private saveComponentFrequency(frequency: string): void {
  if (!this.selectedComponent) return;
  
  const componentIdentifier = this.selectedComponent.neo4jProperty || 
                             this.selectedComponent.id.toString();
  
  const validFrequency = frequency as 'manual' | 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly';
  
  const configUpdate = {
    component_name: this.selectedComponent.name,
    neo4j_property: this.selectedComponent.neo4jProperty,
    update_frequency: frequency,
    enabled: frequency !== 'manual',
    target_property: this.selectedComponent.neo4jProperty || componentIdentifier
  };
  
  this.http.put(`${environment.riskApiUrl}/components/custom/${componentIdentifier}/config`, configUpdate)
    .subscribe({
      next: (response) => {
        if (this.selectedComponent) {
          this.selectedComponent.schedule = {
            frequency: validFrequency,
            enabled: frequency !== 'manual'
          };
        }
        this.showSuccess('Schedule Updated', 
          `${this.selectedComponent?.name} will run ${frequency === 'manual' ? 'manually' : frequency}`);
        this.selectedComponent = null;
      },
      error: (error) => {
        this.showError('Update Failed', error.error?.message || 'Failed to update schedule');
        this.selectedComponent = null;
      }
    });
}

toggleComponentAutomation(component: ComponentConfig): void {
  const componentIdentifier = component.neo4jProperty || component.id.toString();
  const newEnabledState = !component.schedule?.enabled;
  
  const configUpdate = {
    component_name: component.name,
    neo4j_property: component.neo4jProperty,
    update_frequency: component.schedule?.frequency || 'manual',
    enabled: newEnabledState,
    target_property: component.neo4jProperty || componentIdentifier
  };
  
  this.http.put(`${environment.riskApiUrl}/components/custom/${componentIdentifier}/config`, configUpdate)
    .subscribe({
      next: (response) => {
        if (component.schedule) {
          component.schedule.enabled = newEnabledState;
        } else {
          component.schedule = {
            frequency: 'manual',
            enabled: newEnabledState
          };
        }
        
        const action = newEnabledState ? 'resumed' : 'paused';
        this.showSuccess(`Automation ${action.charAt(0).toUpperCase() + action.slice(1)}`, 
          `${component.name} automation has been ${action}`);
      },
      error: (error) => {
        this.showError('Toggle Failed', error.error?.message || 'Failed to toggle automation');
      }
    });
}

getAutomationStatus(component: ComponentConfig): string {
  return component.schedule?.enabled ? 'active' : 'paused';
}

getToggleButtonText(component: ComponentConfig): string {
  return component.schedule?.enabled ? 'Pause' : 'Resume';
}

getToggleButtonClass(component: ComponentConfig): string {
  return component.schedule?.enabled ? 'btn-warning' : 'btn-success';
}

 loadComponents(): void {
  this.loading = true;
  this.componentConfigService.getAvailableComponents().subscribe({
    next: (response) => {
      this.components = response.available_components.map((comp: any) => {
        return {
          ...comp,
          identifier: comp.neo4jProperty || comp.name?.toLowerCase().replace(/\s+/g, '_'),
          displayId: comp.neo4jProperty || comp.name?.toLowerCase().replace(/\s+/g, '_'),
          schedule: comp.schedule || { frequency: 'manual', enabled: false }
        };
      });
      this.loading = false;
      
      this.components.forEach(component => {
        if (component.isConfigured) {
          this.startComponentTimer(component);
        }
        
        // Load automation config for each component to get schedule info
        const componentIdentifier = component.neo4jProperty || component.id.toString();
        this.http.get(`${environment.riskApiUrl}/components/custom/${componentIdentifier}/config`).subscribe({
          next: (config: any) => {
            if (config.automation) {
              component.schedule = {
                frequency: config.automation.update_frequency || 'manual',
                enabled: config.automation.enabled || false
              };
            }
          },
          error: (error) => {
            console.log(`No automation config for ${componentIdentifier}`);
          }
        });
      });
    },
    error: (error) => {
      console.error('Failed to load components:', error);
      this.showError('Loading Error', 'Failed to load components from configuration file');
      this.components = [];
      this.loading = false;
    }
  });
}

 copyComponentId(component: ComponentConfig): void {
   const identifier = component.neo4jProperty || 
                   component.name?.toLowerCase().replace(/\s+/g, '_') || 
                   component.id.toString();
   
   navigator.clipboard.writeText(identifier).then(() => {
     this.showSuccess('Copied!', `Component ID "${identifier}" copied to clipboard`);
   }).catch(err => {
     console.error('Failed to copy:', err);
   });
 }

 private applyAutomationFromConfig(component: ComponentConfig, automation: any): void {
  this.showInfo('Auto-Configuring', `Applying configuration for ${component.name}...`);
  
  const config = {
    calculationMethod: automation.calculation_method || 'query_result',
    dataSource: automation.data_source || { type: 'manual' },
    schedule: {
      frequency: automation.update_frequency || 'manual',
      enabled: automation.enabled || false,
      time: automation.schedule_time
    },
    isConfigured: true
  };
  
  component.calculationMethod = config.calculationMethod;
  component.dataSource = config.dataSource;
  component.schedule = config.schedule;
  component.isConfigured = true;
  
  if (automation.data_source?.type === 'neo4j_query' && automation.data_source?.query) {
    this.executeQueryAndUpdateNeo4j(component, automation);
  } else if (automation.data_source?.type === 'static_value') {
    const value = automation.data_source.value || 0;
    this.updateNeo4jProperty(component, value);
  } else {
    this.showSuccess('Configuration Applied', 
      `${component.name} has been configured successfully!`);
  }
  
  this.componentConfigService.saveComponentConfiguration(component.id, config).subscribe({
    next: () => {
      console.log('Configuration saved');
      this.startComponentTimer(component);
    },
    error: (error) => {
      console.error('Failed to save configuration:', error);
    }
  });
}

 private executeQueryAndUpdateNeo4j(component: ComponentConfig, automation: any): void {
  const componentIdentifier = component.neo4jProperty || 
                             component.name?.toLowerCase().replace(/\s+/g, '_') || 
                             component.id.toString();
  
  this.http.post(`${environment.riskApiUrl}/components/custom/${componentIdentifier}/execute`, {
    query: automation.data_source.query,
    update_neo4j: true,
    target_property: automation.target_property || componentIdentifier
  }).subscribe({
    next: (result: any) => {
      if (result.value !== undefined) {
        component.currentValue = result.value;
        this.showSuccess('Query Executed & Neo4j Updated', 
          `${component.name} value updated to: ${result.value} and written to Neo4j`);
      }
    },
    error: (error) => {
      if (error.error?.user_action_required) {
        this.showError('Configuration Required', 
          error.error.message || 'Please edit the query in component_automation_config.yaml file');
      } else if (error.error?.blocked_keyword) {
        this.showError('Query Blocked', 
          `${error.error.message}\nBlocked keyword: ${error.error.blocked_keyword}`);
      } else if (error.error?.hint) {
        this.showError('Query Error', 
          `${error.error.message}\nHint: ${error.error.hint}`);
      } else {
        this.showError('Query Failed', 
          error.error?.message || `Failed to execute query: ${error.message}`);
      }
    }
  });
}

private updateNeo4jProperty(component: ComponentConfig, value: number): void {
  const componentIdentifier = component.neo4jProperty || 
                             component.name?.toLowerCase().replace(/\s+/g, '_') || 
                             component.id.toString();
  
  this.http.post(`${environment.riskApiUrl}/components/neo4j/update`, {
    property: componentIdentifier,
    value: value
  }).subscribe({
    next: () => {
      component.currentValue = value;
      this.showSuccess('Neo4j Updated', 
        `${component.name} value set to ${value} in Neo4j`);
    },
    error: (error) => {
      this.showError('Update Failed', `Failed to update Neo4j: ${error.message}`);
    }
  });
}

 private executeQueryForComponent(component: ComponentConfig, query: string): void {
  const componentIdentifier = component.neo4jProperty || 
                             component.name?.toLowerCase().replace(/\s+/g, '_') || 
                             component.id.toString();

  this.http.post(`${environment.riskApiUrl}/components/custom/${componentIdentifier}/execute`, {
    query: query,
    update_neo4j: true,
    target_property: component.neo4jProperty || componentIdentifier
  }).subscribe({
    next: (result: any) => {
      if (result.value !== undefined) {
        component.currentValue = result.value;
        this.showSuccess('Query Executed & Neo4j Updated', 
          `${component.name} value updated to: ${result.value} and written to Neo4j`);
      }
    },
    error: (error) => {
      if (error.error?.user_action_required) {
        this.showError('Configuration Required', 
          error.error.message || 'Please edit the query in component_automation_config.yaml file');
      } else if (error.error?.blocked_keyword) {
        this.showError('Query Blocked', 
          `${error.error.message}\nBlocked keyword: ${error.error.blocked_keyword}`);
      } else if (error.error?.hint) {
        this.showError('Query Error', 
          `${error.error.message}\nHint: ${error.error.hint}`);
      } else {
        this.showError('Query Failed', 
          error.error?.message || `Failed to execute query: ${error.message}`);
      }
    }
  });
}

private openManualConfigModal(component: ComponentConfig): void {
  this.selectedComponent = component;
  this.selectedMethod = component.calculationMethod || 'manual';
  // Remove dataSource initialization
  this.schedule = component.schedule || { 
    frequency: 'manual', 
    enabled: false 
  };
  this.showConfigModal = true;
  this.testResults = null;
}

private applyComponentConfiguration(component: ComponentConfig, configData: any): void {
  this.showInfo('Applying Configuration', `Configuring ${component.name} automatically...`);
  
  const automation = configData.automation;
  
  if (!automation) {
    this.openManualConfigModal(component);
    return;
  }
  
  // Apply only update frequency configuration
  component.schedule = {
    frequency: automation.update_frequency || 'manual',
    enabled: automation.enabled || false
  };
  
  component.calculationMethod = automation.calculation_method || 'query_result';
  component.neo4jProperty = automation.neo4j_property || automation.target_property;
  
  this.showSuccess('Configuration Applied', 
    `${component.name} configured with ${automation.update_frequency} updates`);
}

// Update save configuration method
saveComponentConfiguration(): void {
  if (!this.selectedComponent) return;
  
  const componentIdentifier = this.selectedComponent.neo4jProperty || 
                             this.selectedComponent.id.toString();
  
  const configUpdate = {
    component_name: this.selectedComponent.name,
    neo4j_property: this.selectedComponent.neo4jProperty,
    update_frequency: this.schedule.frequency,
    enabled: this.schedule.enabled,
    target_property: this.selectedComponent.neo4jProperty || componentIdentifier
  };
  
  this.http.put(`${environment.riskApiUrl}/components/custom/${componentIdentifier}/config`, configUpdate)
    .subscribe({
      next: (response) => {
        this.showSuccess('Configuration Saved', 
          `Update frequency set to ${this.schedule.frequency}`);
        this.closeConfigModal();
      },
      error: (error) => {
        this.showError('Save Failed', error.error?.message || 'Failed to save configuration');
      }
    });
}

 closeConfigModal(): void {
   this.showConfigModal = false;
   this.selectedComponent = null;
   this.testResults = null;
 }

 onMethodChange(): void {
   this.dataSource.type = this.selectedMethod as any;
   this.testResults = null;
 }

 private showConfirm(title: string, message: string, confirmText: string = 'OK', cancelText: string = 'Cancel'): Promise<boolean> {
   return new Promise((resolve) => {
     this.confirmModalData = {
       title,
       message,
       confirmText,
       cancelText,
       onConfirm: () => {
         this.closeConfirmModal();
         resolve(true);
       },
       onCancel: () => {
         this.closeConfirmModal();
         resolve(false);
       }
     };
     this.showConfirmModal = true;
   });
 }

 closeConfirmModal() {
   this.showConfirmModal = false;
 }

 testConfiguration(): void {
   if (!this.selectedComponent) return;
   
   this.testing = true;
   this.testResults = null;

   const testConfig = {
     calculationMethod: this.selectedMethod,
     dataSource: this.dataSource,
     schedule: this.schedule
   };

   this.componentConfigService.testComponentConfiguration(this.selectedComponent.id, testConfig).subscribe({
     next: (results) => {
       this.testResults = results;
       this.testing = false;
     },
     error: (error) => {
       console.error('Test failed:', error);
       this.testResults = { error: error.message || 'Test failed' };
       this.testing = false;
     }
   });
 }

 saveConfiguration(): void {
   if (!this.selectedComponent) return;
   
   this.saving = true;

   const config = {
     calculationMethod: this.selectedMethod,
     dataSource: this.dataSource,
     schedule: this.schedule,
     isConfigured: true
   };

   this.componentConfigService.saveComponentConfiguration(this.selectedComponent.id, config).subscribe({
     next: () => {
       this.saving = false;
       this.closeConfigModal();
       this.loadComponents();
     },
     error: (error) => {
       console.error('Save failed:', error);
       this.saving = false;
     }
   });
 }

 executeNow(): void {
   if (!this.selectedComponent) return;

   this.componentConfigService.executeComponentCalculation(this.selectedComponent.id).subscribe({
     next: (result) => {
       console.log('Execution started:', result);
       this.showSuccess('Execution Started', 'Component calculation started successfully!');
     },
     error: (error) => {
       console.error('Execution failed:', error);
       this.showError('Execution Failed', 'Failed to start component calculation: ' + error.message);
     }
   });
 }

 async deleteComponent(component: ComponentConfig): Promise<void> {
   const confirmed = await this.showConfirm(
     'Delete Component',
     `Are you sure you want to delete "${component.name}"?\n\nThis will:\n• Remove the component from configuration\n• Delete the "${component.neo4jProperty}" property from all nodes in Neo4j\n\nThis action cannot be undone.`,
     'Delete Component',
     'Cancel'
   );
   
   if (!confirmed) return;

   console.log('Deleting component:', component.id, component.name);

   this.componentConfigService.deleteCustomComponent(component.id).subscribe({
     next: (response) => {
       console.log('Delete response:', response);
       
       let message = `"${component.name}" has been deleted successfully`;
       if (response.neo4jDeletion && response.neo4jDeletion.nodesUpdated) {
         message += `\n\nRemoved from ${response.neo4jDeletion.nodesUpdated} nodes in Neo4j`;
       }
       if (response.warning) {
         message += `\n\nWarning: ${response.warning}`;
       }
       
       this.showSuccess('Component Deleted', message);
       this.loadComponents();
     },
     error: (error) => {
       console.error('Error deleting component:', error);
       this.showError('Delete Failed', 'Failed to delete component: ' + error.message);
     }
   });
 }

 private startTimer() {
   this.timerInterval = setInterval(() => {
     this.components.forEach(component => {
       if (!this.componentTimers[component.id]) {
         this.componentTimers[component.id] = 0;
       }
       this.componentTimers[component.id]++;
     });
   }, 1000);
 }

 startComponentTimer(component: ComponentConfig): void {
   const timerId = component.id;
   
   if (!this.componentTimers[timerId]) {
     this.componentTimers[timerId] = 0;
   }
   
   if (this.timerInterval) {
     clearInterval(this.timerInterval);
   }
   
   this.timerInterval = setInterval(() => {
     this.componentTimers[timerId]++;
   }, 1000);
 }

 getTimerDisplay(component: ComponentConfig): string {
   const timerId = component.id;
   const seconds = this.componentTimers[timerId] || 0;
   
   if (seconds === 0) return '--:--';
   
   const hours = Math.floor(seconds / 3600);
   const minutes = Math.floor((seconds % 3600) / 60);
   const secs = seconds % 60;
   
   if (hours > 0) {
     return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
   }
   return `${minutes}:${secs.toString().padStart(2, '0')}`;
 }

 getStatusBadgeClass(component: ComponentConfig): string {
  if (component.schedule?.enabled && component.schedule?.frequency !== 'manual') {
    return 'badge-active';
  }
  if (component.schedule?.frequency !== 'manual' && !component.schedule?.enabled) {
    return 'badge-paused';
  }
  if (component.isConfigured) return 'badge-success';
  if (component.currentValue === 0) return 'badge-warning';
  return 'badge-secondary';
}

getStatusText(component: ComponentConfig): string {
  if (component.schedule?.enabled && component.schedule?.frequency !== 'manual') {
    return 'Active';
  }
  if (component.schedule?.frequency !== 'manual' && !component.schedule?.enabled) {
    return 'Paused';
  }
  if (component.isConfigured) return 'Configured';
  if (component.currentValue === 0) return 'Needs Configuration';
  return 'Ready';
}

 addCustomComponent() {
   this.customComponent = {
     name: '',
     category: '',
     maxValue: 10
   };
   this.showCustomComponentModal = true;
 }

 closeCustomComponentModal() {
   this.showCustomComponentModal = false;
   this.customComponent = {
     name: '',
     category: '',
     maxValue: 10
   };
 }

 async saveCustomComponent() {
   if (!this.customComponent.name.trim()) {
     this.showWarning('Validation Error', 'Please enter a component name');
     return;
   }
   
   if (!this.customComponent.category) {
     this.showWarning('Validation Error', 'Please select a category');
     return;
   }
   
   const componentId = this.customComponent.name.toLowerCase()
     .replace(/[^a-z0-9]+/g, '_')
     .replace(/^_+|_+$/g, '');
   
   const componentData = {
     name: this.customComponent.name,
     type: this.customComponent.category,
     maxValue: this.customComponent.maxValue,
     description: this.getAutoDescription(),
     neo4jProperty: componentId,
     identifier: componentId
   };
   
   // First save to config
   this.componentConfigService.saveCustomComponent(componentData).subscribe({
     next: async (response) => {
       // Then write to Neo4j
       try {
         await this.writeComponentToNeo4j(componentData);
         this.showSuccess('Component Created', 
           `${this.customComponent.name} created with ID: ${componentId} and added to Neo4j`);
       } catch (error) {
         this.showWarning('Component Created', 
           `${this.customComponent.name} created but Neo4j update failed`);
       }
       
       this.closeCustomComponentModal();
       this.loadComponents();
     },
     error: (error) => {
       console.error('Failed to save component:', error);
       this.showError('Save Failed', 'Failed to create custom component');
     }
   });
 }

 private async writeComponentToNeo4j(component: any): Promise<any> {
   const componentData = {
     componentName: component.name,
     neo4jProperty: component.neo4jProperty,
     formula: 'setValue',
     method: 'setValue',
     components: [{
       name: component.name,
       neo4jProperty: component.neo4jProperty,
       weight: 0.2,
       maxValue: component.maxValue,
       //currentValue: 0
     }],
     targetType: 'all',
     targetValues: [],
     calculationMode: 'setValue'
   };

   return await this.http.post(`${environment.apiUrl}/write-custom-risk-component`, componentData).toPromise();
 }

 getCategoryIcon(category: string): string {
   const icons: { [key: string]: string } = {
     'security': '🔒',
     'performance': '⚡',
     'compliance': '📋',
     'business': '💼',
     'technical': '⚙️',
     'custom': '🔧'
   };
   return icons[category] || '🔧';
 }

 getAutoDescription(): string {
   if (!this.customComponent.category) return 'Component description...';
   const category = this.customComponent.category.charAt(0).toUpperCase() + this.customComponent.category.slice(1);
   return `${category} component for risk assessment`;
 }

 private showNotification(type: 'success' | 'info' | 'warning' | 'error', title: string, message: string) {
   const notification = {
     id: ++this.notificationId,
     type,
     title,
     message,
     timestamp: Date.now()
   };
   
   this.notifications.push(notification);
   
   const dismissTime = type === 'error' ? 8000 : 5000;
   setTimeout(() => {
     this.dismissNotification(notification.id);
   }, dismissTime);
 }

 private showSuccess(title: string, message: string) {
   this.showNotification('success', title, message);
 }

 private showError(title: string, message: string) {
   this.showNotification('error', title, message);
 }

 private showWarning(title: string, message: string) {
   this.showNotification('warning', title, message);
 }

 private showInfo(title: string, message: string) {
   this.showNotification('info', title, message);
 }

 dismissNotification(id: number) {
   this.notifications = this.notifications.filter(n => n.id !== id);
 }

 getNotificationIcon(type: string): string {
   switch(type) {
     case 'success': return '✅';
     case 'error': return '❌';
     case 'warning': return '⚠️';
     case 'info': return 'ℹ️';
     default: return 'ℹ️';
   }
 }
}