// src/app/services/component-config.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ComponentConfig {
  id: number;
  name: string;
  description: string;
  type: string;
  neo4jProperty: string;
  maxValue: number;
  currentValue: number;
  isConfigured?: boolean;
  calculationMethod?: string;
  dataSource?: ComponentDataSource;
  schedule?: ComponentSchedule;
}

export interface ComponentDataSource {
  type: 'manual' | 'database' | 'api' | 'file' | 'script';
  connectionString?: string;
  query?: string;
  apiUrl?: string;
  headers?: { [key: string]: string };
  mapping?: { [key: string]: any };
  scriptContent?: string;
}

export interface ComponentSchedule {
  frequency: 'manual' | 'minute' | 'hourly' | 'daily' | 'weekly';
  time?: string;
  enabled: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ComponentConfigService {
  private apiUrl = 'http://localhost:5000/api';

  constructor(private http: HttpClient) { }

  getAvailableComponents(): Observable<{available_components: ComponentConfig[]}> {
    return this.http.get<{available_components: ComponentConfig[]}>(`${this.apiUrl}/components/available`);
  }

  saveComponentConfiguration(componentId: number, config: Partial<ComponentConfig>): Observable<any> {
    return this.http.put(`${this.apiUrl}/components/custom/${componentId}/config`, config);
  }

  testComponentConfiguration(componentId: number, config: Partial<ComponentConfig>): Observable<any> {
    return this.http.post(`${this.apiUrl}/components/custom/${componentId}/test`, config);
  }

  deleteCustomComponent(componentId: number): Observable<any> {
  return this.http.delete(`http://localhost:3000/api/risk/components/custom/${componentId}`);
}

  executeComponentCalculation(componentId: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/components/custom/${componentId}/execute`, {});
  }

  saveCustomComponent(component: any): Observable<any> {
  return this.http.post(`${this.apiUrl}/risk/components/custom`, component);
}
}