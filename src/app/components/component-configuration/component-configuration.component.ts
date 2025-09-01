// src/app/components/component-configuration/component-configuration.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ComponentConfigService, ComponentConfig, ComponentDataSource, ComponentSchedule } from '../../services/component-config.service';

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

  frequencies = [
    { id: 'manual', name: 'Manual Only' },
    { id: 'hourly', name: 'Every Hour' },
    { id: 'daily', name: 'Daily' },
    { id: 'weekly', name: 'Weekly' }
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

  configureComponent(component: ComponentConfig): void {
    this.selectedComponent = component;
    this.selectedMethod = component.calculationMethod || 'manual';
    this.dataSource = component.dataSource || { type: 'manual' };
    this.schedule = component.schedule || { frequency: 'manual', enabled: false };
    this.testResults = null;
    this.showConfigModal = true;
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

  getTimerDisplay(component: any): string {
    const seconds = this.componentTimers[component.id] || 0;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // Modify your existing loadComponents method to start the timer
  async loadComponents() {
    try {
      this.loading = true;
      const response = await this.componentConfigService.getAvailableComponents().toPromise();
      
      if (response && response.available_components) {
        this.components = response.available_components;
        
        // Initialize timers for all components
        this.components.forEach(component => {
          this.componentTimers[component.id] = 0;
        });
        
        // Start the global timer
        if (!this.timerInterval) {
          this.startTimer();
        }
        
        console.log('Components loaded successfully:', this.components);
      } else {
        console.warn('No components found, showing fallback message');
        this.components = [];
      }
      
    } catch (error) {
      console.error('Error loading components:', error);
      this.showError('Loading Error', 'Failed to load components from configuration file');
      this.components = [];
    } finally {
      this.loading = false;
    }
  }

  getStatusBadgeClass(component: ComponentConfig): string {
    if (component.isConfigured) return 'badge-success';
    if (component.currentValue === 0) return 'badge-warning';
    return 'badge-secondary';
  }

  getStatusText(component: ComponentConfig): string {
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
    this.showWarning('Validation Error', 'Please select a component category');
    return;
  }
  
  if (this.customComponent.maxValue < 1 || this.customComponent.maxValue > 10) {
    this.showWarning('Validation Error', 'Max value must be between 1 and 10');
    return;
  }
  
  const autoDescription = `${this.customComponent.category.charAt(0).toUpperCase() + this.customComponent.category.slice(1)} component for risk assessment`;
  
  const categoryIcons: { [key: string]: string } = {
    'security': '🔒',
    'performance': '⚡',
    'compliance': '📋',
    'business': '💼',
    'technical': '⚙️',
    'custom': '🔧'
  };
  
  const newComponent = {
    id: Date.now(),
    name: this.customComponent.name.trim(),
    type: 'custom',
    icon: categoryIcons[this.customComponent.category] || '🔧',
    description: autoDescription,
    weight: 0.2,
    maxValue: this.customComponent.maxValue,
    currentValue: 0,
    neo4jProperty: this.customComponent.name.trim().replace(/[^a-zA-Z0-9]/g, '_'),
    isComposite: false
  };
  
  try {
    this.saving = true;
    
    // Save to config file
    const configResponse = await this.componentConfigService.saveCustomComponent(newComponent).toPromise();
    console.log('Component saved to config:', configResponse);
    
    // Write to Neo4j with score of 0
    await this.writeComponentToNeo4j(newComponent);
    
    // Initialize timer for the new component
    this.componentTimers[newComponent.id] = 0;
    
    this.showSuccess(
      'Component Created Successfully', 
      `Component "${newComponent.name}" created with initial value of 0 and timer started.`
    );
    
    this.closeCustomComponentModal();
    this.loadComponents();
    
  } catch (error) {
    console.error('Error saving component:', error);
    this.showError(
      'Component Creation Failed', 
      `Failed to create component: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  } finally {
    this.saving = false;
  }
}

private async writeComponentToNeo4j(component: any): Promise<any> {
  // Use the existing API to write to Neo4j
  const componentData = {
    componentName: component.name,
    neo4jProperty: component.neo4jProperty,
    formula: 'setValue',
    method: 'setValue',
    components: [{
      name: component.name,
      neo4jProperty: component.neo4jProperty,
      weight: component.weight,
      maxValue: component.maxValue,
      currentValue: 0
    }],
    targetType: 'all',
    targetValues: [],
    calculationMode: 'setValue'
  };

  return await this.http.post('http://localhost:3000/api/write-custom-risk-component', componentData).toPromise();
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

  // Notification helper methods
  private showNotification(type: 'success' | 'info' | 'warning' | 'error', title: string, message: string) {
    const notification = {
      id: ++this.notificationId,
      type,
      title,
      message,
      timestamp: Date.now()
    };
    
    this.notifications.push(notification);
    
    // Auto-dismiss after 5 seconds (except for errors which stay longer)
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