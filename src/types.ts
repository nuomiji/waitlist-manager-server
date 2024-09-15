export interface Customer {
    id: number;
    name: string;
    partySize: number;
    status: 'waiting' | 'seated' | 'tableReady';
}