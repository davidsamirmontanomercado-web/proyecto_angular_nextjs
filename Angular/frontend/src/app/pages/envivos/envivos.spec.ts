import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EnvivosComponent } from './envivos';

describe('EnvivosComponent', () => {
  let component: EnvivosComponent;
  let fixture: ComponentFixture<EnvivosComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EnvivosComponent] }).compileComponents();
    fixture = TestBed.createComponent(EnvivosComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });
  it('should create', () => { expect(component).toBeTruthy(); });
});