import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CrearLiveComponent } from './crear-live';

describe('CrearLiveComponent', () => {
  let component: CrearLiveComponent;
  let fixture: ComponentFixture<CrearLiveComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CrearLiveComponent] }).compileComponents();
    fixture = TestBed.createComponent(CrearLiveComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });
  it('should create', () => { expect(component).toBeTruthy(); });
});