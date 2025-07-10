import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError, timeout, map } from 'rxjs/operators';
import { ApiResponse } from '../models/network-data';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly API_BASE_URL = 'http://localhost:3001/api';
  private readonly API_DEVICE_DETAILS_URL = 'http://localhost:3000/api';
  private readonly REQUEST_TIMEOUT = 30000;

  constructor(private http: HttpClient) {}

  // Health check
  checkApiHealth(): Observable<boolean> {
    return this.http.get(`${this.API_BASE_URL}/get-virtual-network-data`).pipe(
      timeout(5000),
      map(() => true), // If request succeeds, return true
      catchError(() => of(false)) // If request fails, return false
    );
  }

  // Get virtual network data
  getVirtualNetworkData(): Observable<any[]> {
    return this.http.get<any[]>(`${this.API_BASE_URL}/get-virtual-network-data`)
      .pipe(
        timeout(this.REQUEST_TIMEOUT),
        catchError(this.handleError)
      );
  }

  // Fetch CIDR data and populate JSON
  fetchCidrData(): Observable<ApiResponse> {
    return this.http.get<ApiResponse>(`${this.API_BASE_URL}/fetch-cidr-data`)
      .pipe(
        timeout(this.REQUEST_TIMEOUT),
        catchError(this.handleError)
      );
  }

  // Get device details from port 3000
  getDeviceDetails(): Observable<any[]> {
    return this.http.get<any[]>(`${this.API_DEVICE_DETAILS_URL}/get-virtual-network-data`)
      .pipe(
        timeout(this.REQUEST_TIMEOUT),
        catchError(this.handleError)
      );
  }

  // Fetch subnet details with expansion
  fetchSubnetDetails(subnetCidr: string): Observable<any[]> {
    const params = new HttpParams().set('netRange', subnetCidr);
    return this.http.get<any[]>(`${this.API_DEVICE_DETAILS_URL}/fetch-subnet-data`, { params })
      .pipe(
        timeout(this.REQUEST_TIMEOUT),
        catchError(this.handleError)
      );
  }

  // Expand virtual network node
  expandVirtualNetwork(nodeId: string, nodeType: string): Observable<any> {
    return this.http.get<any>(`${this.API_DEVICE_DETAILS_URL}/expand-virtual-network/${encodeURIComponent(nodeId)}/${encodeURIComponent(nodeType)}`)
      .pipe(
        timeout(this.REQUEST_TIMEOUT),
        catchError(this.handleError)
      );
  }

  private handleError(error: any): Observable<never> {
    console.error('API Error:', error);
    return throwError(() => error);
  }
}